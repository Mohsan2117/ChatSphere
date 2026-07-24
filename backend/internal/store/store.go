package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Store struct {
	mu   sync.Mutex
	path string
	data dataFile
	db   *pgxpool.Pool
}

type dataFile struct {
	Users []User `json:"users"`
}

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	FirstName    string    `json:"firstName"`
	LastName     string    `json:"lastName"`
	PasswordHash string    `json:"passwordHash"`
	AvatarURL    string    `json:"avatarUrl,omitempty"`
	Blocked      bool      `json:"blocked"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	SenderEmail    string    `json:"senderEmail"`
	SenderID       string    `json:"senderId,omitempty"`
	RecipientID    string    `json:"recipientId"`
	Body           string    `json:"body"`
	AttachmentName string    `json:"attachmentName,omitempty"`
	AttachmentType string    `json:"attachmentType,omitempty"`
	AttachmentKind string    `json:"attachmentKind,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

func New(path string, databaseURL string) (*Store, error) {
	s := &Store{path: path}
	if strings.TrimSpace(databaseURL) != "" {
		pool, err := pgxpool.New(context.Background(), databaseURL)
		if err != nil {
			return nil, err
		}
		s.db = pool
		if err := s.migrate(context.Background()); err != nil {
			pool.Close()
			return nil, err
		}
		return s, nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) UpsertUser(email, firstName, lastName, password, avatarURL string) (User, error) {
	if s.db != nil {
		return s.upsertUserDB(email, firstName, lastName, password, avatarURL)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	email = strings.ToLower(strings.TrimSpace(email))
	now := time.Now().UTC()
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}

	for index := range s.data.Users {
		if s.data.Users[index].Email == email {
			s.data.Users[index].FirstName = strings.TrimSpace(firstName)
			s.data.Users[index].LastName = strings.TrimSpace(lastName)
			s.data.Users[index].PasswordHash = string(passwordHash)
			if avatarURL != "" {
				s.data.Users[index].AvatarURL = avatarURL
			}
			s.data.Users[index].UpdatedAt = now
			if err := s.saveLocked(); err != nil {
				return User{}, err
			}
			return s.data.Users[index], nil
		}
	}

	user := User{
		ID:           randomID(),
		Email:        email,
		FirstName:    strings.TrimSpace(firstName),
		LastName:     strings.TrimSpace(lastName),
		PasswordHash: string(passwordHash),
		AvatarURL:    avatarURL,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	s.data.Users = append(s.data.Users, user)
	if err := s.saveLocked(); err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Store) Authenticate(email, password string) (User, error) {
	if s.db != nil {
		return s.authenticateDB(email, password)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	email = strings.ToLower(strings.TrimSpace(email))
	for _, user := range s.data.Users {
		if user.Email == email {
			if user.Blocked {
				return User{}, errors.New("account blocked")
			}
			if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
				return User{}, errors.New("invalid email or password")
			}
			return user, nil
		}
	}
	return User{}, errors.New("invalid email or password")
}

func (s *Store) UserByEmail(email string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if s.db != nil {
		return s.userByEmailDB(email)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, user := range s.data.Users {
		if user.Email == email {
			return user, nil
		}
	}
	return User{}, errors.New("user not found")
}

func (s *Store) UserExists(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	if s.db != nil {
		var exists bool
		err := s.db.QueryRow(context.Background(), `select exists(select 1 from app_users where email = $1)`, email).Scan(&exists)
		return err == nil && exists
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, user := range s.data.Users {
		if user.Email == email {
			return true
		}
	}
	return false
}

func (s *Store) UpdatePassword(email, password string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	if s.db != nil {
		result, err := s.db.Exec(context.Background(), `
			update app_users set password_hash = $2, updated_at = now()
			where email = $1
		`, email, string(passwordHash))
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return errors.New("user not found")
		}
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for index := range s.data.Users {
		if s.data.Users[index].Email == email {
			s.data.Users[index].PasswordHash = string(passwordHash)
			s.data.Users[index].UpdatedAt = time.Now().UTC()
			return s.saveLocked()
		}
	}
	return errors.New("user not found")
}

func (s *Store) UpdateProfile(email, firstName, lastName, avatarURL string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	firstName = strings.TrimSpace(firstName)
	lastName = strings.TrimSpace(lastName)
	if firstName == "" {
		return User{}, errors.New("first name is required")
	}

	if s.db != nil {
		var user User
		err := s.db.QueryRow(context.Background(), `
			update app_users set
				first_name = $2,
				last_name = $3,
				avatar_url = case when $4 = '' then avatar_url else $4 end,
				updated_at = now()
			where email = $1
			returning id, email, first_name, last_name, password_hash, avatar_url, blocked, created_at, updated_at
		`, email, firstName, lastName, strings.TrimSpace(avatarURL)).
			Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
		return user, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for index := range s.data.Users {
		if s.data.Users[index].Email == email {
			s.data.Users[index].FirstName = firstName
			s.data.Users[index].LastName = lastName
			if strings.TrimSpace(avatarURL) != "" {
				s.data.Users[index].AvatarURL = strings.TrimSpace(avatarURL)
			}
			s.data.Users[index].UpdatedAt = time.Now().UTC()
			if err := s.saveLocked(); err != nil {
				return User{}, err
			}
			return s.data.Users[index], nil
		}
	}
	return User{}, errors.New("user not found")
}

func (s *Store) SearchUsers(query string) []User {
	if s.db != nil {
		users, _ := s.searchUsersDB(query, false)
		return users
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	query = strings.ToLower(strings.TrimSpace(query))
	users := make([]User, 0, len(s.data.Users))
	for _, user := range s.data.Users {
		if user.Blocked {
			continue
		}
		fullName := strings.ToLower(strings.TrimSpace(user.FirstName + " " + user.LastName))
		if query == "" || strings.Contains(fullName, query) || strings.Contains(user.Email, query) {
			users = append(users, user)
		}
	}
	return users
}

func (s *Store) AllUsers() []User {
	if s.db != nil {
		users, _ := s.searchUsersDB("", true)
		return users
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	users := make([]User, len(s.data.Users))
	copy(users, s.data.Users)
	return users
}

func (s *Store) DeleteUser(id string) bool {
	if s.db != nil {
		var email string
		if err := s.db.QueryRow(context.Background(), `select email from app_users where id = $1`, id).Scan(&email); err != nil {
			return false
		}
		_, _ = s.db.Exec(context.Background(), `delete from messages where sender_email = $1 or recipient_id = $2`, email, id)
		result, err := s.db.Exec(context.Background(), `delete from app_users where id = $1`, id)
		return err == nil && result.RowsAffected() > 0
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for index, user := range s.data.Users {
		if user.ID == id {
			s.data.Users = append(s.data.Users[:index], s.data.Users[index+1:]...)
			_ = s.saveLocked()
			return true
		}
	}
	return false
}

func (s *Store) SetUserBlocked(id string, blocked bool) (User, bool) {
	if s.db != nil {
		var user User
		err := s.db.QueryRow(context.Background(), `
			update app_users set blocked = $2, updated_at = now()
			where id = $1
			returning id, email, first_name, last_name, password_hash, avatar_url, blocked, created_at, updated_at
		`, id, blocked).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
		return user, err == nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for index := range s.data.Users {
		if s.data.Users[index].ID == id {
			s.data.Users[index].Blocked = blocked
			s.data.Users[index].UpdatedAt = time.Now().UTC()
			_ = s.saveLocked()
			return s.data.Users[index], true
		}
	}
	return User{}, false
}

func (s *Store) SaveMessage(senderEmail, recipientID, body, attachmentName, attachmentType, attachmentKind string) (Message, error) {
	if s.db == nil {
		return Message{}, errors.New("database is not configured")
	}
	sender, err := s.UserByEmail(senderEmail)
	if err != nil {
		return Message{}, err
	}
	message := Message{
		ID:             randomID(),
		ConversationID: conversationID(sender.ID, recipientID),
		SenderEmail:    sender.Email,
		SenderID:       sender.ID,
		RecipientID:    strings.TrimSpace(recipientID),
		Body:           strings.TrimSpace(body),
		AttachmentName: strings.TrimSpace(attachmentName),
		AttachmentType: strings.TrimSpace(attachmentType),
		AttachmentKind: strings.TrimSpace(attachmentKind),
		CreatedAt:      time.Now().UTC(),
	}
	_, err = s.db.Exec(context.Background(), `
		insert into messages (id, conversation_id, sender_email, recipient_id, body, attachment_name, attachment_type, attachment_kind, created_at)
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, message.ID, message.ConversationID, message.SenderEmail, message.RecipientID, message.Body, message.AttachmentName, message.AttachmentType, message.AttachmentKind, message.CreatedAt)
	return message, err
}

func (s *Store) ListMessages(userEmail, otherUserID string) ([]Message, error) {
	if s.db == nil {
		return []Message{}, nil
	}
	user, err := s.UserByEmail(userEmail)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(context.Background(), `
		select m.id, m.conversation_id, m.sender_email, coalesce(u.id, ''), m.recipient_id, m.body, m.attachment_name, m.attachment_type, m.attachment_kind, m.created_at
		from messages m
		left join app_users u on u.email = m.sender_email
		where conversation_id = $1
		order by m.created_at asc
	`, conversationID(user.ID, otherUserID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := []Message{}
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.SenderEmail, &message.SenderID, &message.RecipientID, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (s *Store) ListInboxMessages(userEmail string) ([]Message, error) {
	if s.db == nil {
		return []Message{}, nil
	}
	user, err := s.UserByEmail(userEmail)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(context.Background(), `
		select m.id, m.conversation_id, m.sender_email, coalesce(u.id, ''), m.recipient_id, m.body, m.attachment_name, m.attachment_type, m.attachment_kind, m.created_at
		from messages m
		left join app_users u on u.email = m.sender_email
		where m.sender_email = $1 or m.recipient_id = $2
		order by m.created_at asc
	`, strings.ToLower(strings.TrimSpace(userEmail)), user.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := []Message{}
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.SenderEmail, &message.SenderID, &message.RecipientID, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (s *Store) migrate(ctx context.Context) error {
	_, err := s.db.Exec(ctx, `
		create table if not exists app_users (
			id text primary key,
			email text unique not null,
			first_name text not null,
			last_name text not null default '',
			password_hash text not null,
			avatar_url text not null default '',
			blocked boolean not null default false,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists messages (
			id text primary key,
			conversation_id text not null,
			sender_email text not null,
			recipient_id text not null,
			body text not null default '',
			attachment_name text not null default '',
			attachment_type text not null default '',
			attachment_kind text not null default '',
			created_at timestamptz not null default now()
		);
		create index if not exists idx_messages_conversation_created on messages (conversation_id, created_at);
	`)
	return err
}

func (s *Store) upsertUserDB(email, firstName, lastName, password, avatarURL string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	var user User
	err = s.db.QueryRow(context.Background(), `
		insert into app_users (id, email, first_name, last_name, password_hash, avatar_url)
		values ($1,$2,$3,$4,$5,$6)
		on conflict (email) do update set
			first_name = excluded.first_name,
			last_name = excluded.last_name,
			password_hash = excluded.password_hash,
			avatar_url = case when excluded.avatar_url = '' then app_users.avatar_url else excluded.avatar_url end,
			updated_at = now()
		returning id, email, first_name, last_name, password_hash, avatar_url, blocked, created_at, updated_at
	`, randomID(), email, strings.TrimSpace(firstName), strings.TrimSpace(lastName), string(passwordHash), avatarURL).
		Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func (s *Store) authenticateDB(email, password string) (User, error) {
	user, err := s.userByEmailDB(email)
	if err != nil {
		return User{}, errors.New("invalid email or password")
	}
	if user.Blocked {
		return User{}, errors.New("account blocked")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return User{}, errors.New("invalid email or password")
	}
	return user, nil
}

func (s *Store) userByEmailDB(email string) (User, error) {
	var user User
	err := s.db.QueryRow(context.Background(), `
		select id, email, first_name, last_name, password_hash, avatar_url, blocked, created_at, updated_at
		from app_users where email = $1
	`, strings.ToLower(strings.TrimSpace(email))).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func (s *Store) searchUsersDB(query string, includeBlocked bool) ([]User, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	rows, err := s.db.Query(context.Background(), `
		select id, email, first_name, last_name, password_hash, avatar_url, blocked, created_at, updated_at
		from app_users
		where ($1 = '' or lower(first_name || ' ' || last_name) like '%' || $1 || '%' or lower(email) like '%' || $1 || '%')
		  and ($2 = true or blocked = false)
		order by created_at desc
	`, query, includeBlocked)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var user User
		if err := rows.Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func conversationID(email string, otherUserID string) string {
	left := strings.ToLower(strings.TrimSpace(email))
	right := strings.TrimSpace(otherUserID)
	if left < right {
		return left + ":" + right
	}
	return right + ":" + left
}

func (s *Store) load() error {
	content, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.data = dataFile{Users: []User{}}
		return s.saveLocked()
	}
	if err != nil {
		return err
	}
	if len(content) == 0 {
		s.data = dataFile{Users: []User{}}
		return nil
	}
	return json.Unmarshal(content, &s.data)
}

func (s *Store) saveLocked() error {
	content, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, content, 0o600)
}

func randomID() string {
	var bytes [12]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(bytes[:])
}
