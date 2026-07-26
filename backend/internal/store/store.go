package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Store struct {
	mu   sync.Mutex
	path string
	data dataFile
	db   *pgxpool.Pool
	my   *sql.DB
}

type messageRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
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
	ID             string     `json:"id"`
	ConversationID string     `json:"conversationId"`
	SenderEmail    string     `json:"senderEmail"`
	SenderID       string     `json:"senderId,omitempty"`
	RecipientID    string     `json:"recipientId"`
	Body           string     `json:"body"`
	AttachmentName string     `json:"attachmentName,omitempty"`
	AttachmentType string     `json:"attachmentType,omitempty"`
	AttachmentKind string     `json:"attachmentKind,omitempty"`
	AttachmentURL  string     `json:"attachmentUrl,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	ReadAt         *time.Time `json:"readAt,omitempty"`
}

type UserBlock struct {
	BlockerID string    `json:"blockerId"`
	BlockedID string    `json:"blockedId"`
	CreatedAt time.Time `json:"createdAt"`
}

type Report struct {
	ID           string     `json:"id"`
	ReporterID   string     `json:"reporterId"`
	ReportedID   string     `json:"reportedId"`
	MessageID    string     `json:"messageId,omitempty"`
	Reason       string     `json:"reason"`
	Status       string     `json:"status"`
	ReporterName string     `json:"reporterName,omitempty"`
	ReportedName string     `json:"reportedName,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	ResolvedAt   *time.Time `json:"resolvedAt,omitempty"`
}

type Attachment struct {
	ID          string    `json:"id"`
	OwnerID     string    `json:"ownerId"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	Kind        string    `json:"kind"`
	SizeBytes   int64     `json:"sizeBytes"`
	Content     []byte    `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
}

func New(path string, databaseURL string) (*Store, error) {
	s := &Store{path: path}
	if strings.TrimSpace(databaseURL) != "" {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(databaseURL)), "mysql://") {
			db, err := sql.Open("mysql", mysqlDSN(databaseURL))
			if err != nil {
				return nil, err
			}
			s.my = db
			if err := s.migrate(context.Background()); err != nil {
				_ = db.Close()
				return nil, err
			}
			return s, nil
		}
		poolConfig, err := pgxpool.ParseConfig(databaseURL)
		if err != nil {
			return nil, err
		}
		poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
		pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
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

func mysqlDSN(databaseURL string) string {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return databaseURL
	}
	password, _ := parsed.User.Password()
	database := strings.TrimPrefix(parsed.Path, "/")
	query := parsed.Query()
	query.Set("parseTime", "true")
	return fmt.Sprintf("%s:%s@tcp(%s)/%s?%s", parsed.User.Username(), password, parsed.Host, database, query.Encode())
}

func (s *Store) UpsertUser(email, firstName, lastName, password, avatarURL string) (User, error) {
	if s.db != nil {
		return s.upsertUserDB(email, firstName, lastName, password, avatarURL)
	}
	if s.my != nil {
		return s.upsertUserMySQL(email, firstName, lastName, password, avatarURL)
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
	if s.my != nil {
		return s.authenticateMySQL(email, password)
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
	if s.my != nil {
		return s.userByEmailMySQL(email)
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

func (s *Store) UserByID(id string) (User, error) {
	id = strings.TrimSpace(id)
	if s.db != nil {
		return s.userByIDDB(id)
	}
	if s.my != nil {
		return s.userByIDMySQL(id)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, user := range s.data.Users {
		if user.ID == id {
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
	if s.my != nil {
		var exists bool
		err := s.my.QueryRowContext(context.Background(), `select exists(select 1 from app_users where email = ?)`, email).Scan(&exists)
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
	if s.my != nil {
		result, err := s.my.ExecContext(context.Background(), `
			update app_users set password_hash = ?, updated_at = utc_timestamp()
			where email = ?
		`, string(passwordHash), email)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
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
			returning id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, now()), coalesce(updated_at, now())
		`, email, firstName, lastName, strings.TrimSpace(avatarURL)).
			Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
		return user, err
	}
	if s.my != nil {
		_, err := s.my.ExecContext(context.Background(), `
			update app_users set
				first_name = ?,
				last_name = ?,
				avatar_url = case when ? = '' then avatar_url else ? end,
				updated_at = utc_timestamp()
			where email = ?
		`, firstName, lastName, strings.TrimSpace(avatarURL), strings.TrimSpace(avatarURL), email)
		if err != nil {
			return User{}, err
		}
		return s.UserByEmail(email)
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
	users, _ := s.SearchUsersWithError(query)
	return users
}

func (s *Store) SearchUsersWithError(query string) ([]User, error) {
	if s.db != nil {
		return s.searchUsersDB(query, false, 50)
	}
	if s.my != nil {
		return s.searchUsersMySQL(query, false, 50)
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
	return users, nil
}

func (s *Store) AllUsers() []User {
	if s.db != nil {
		users, _ := s.searchUsersDB("", true, 500)
		return users
	}
	if s.my != nil {
		users, _ := s.searchUsersMySQL("", true, 500)
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
		_, _ = s.db.Exec(context.Background(), `delete from attachments where owner_id = $1`, id)
		result, err := s.db.Exec(context.Background(), `delete from app_users where id = $1`, id)
		return err == nil && result.RowsAffected() > 0
	}
	if s.my != nil {
		var email string
		if err := s.my.QueryRowContext(context.Background(), `select email from app_users where id = ?`, id).Scan(&email); err != nil {
			return false
		}
		_, _ = s.my.ExecContext(context.Background(), `delete from messages where sender_email = ? or recipient_id = ?`, email, id)
		_, _ = s.my.ExecContext(context.Background(), `delete from attachments where owner_id = ?`, id)
		result, err := s.my.ExecContext(context.Background(), `delete from app_users where id = ?`, id)
		affected, _ := result.RowsAffected()
		return err == nil && affected > 0
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
			returning id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, now()), coalesce(updated_at, now())
		`, id, blocked).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
		return user, err == nil
	}
	if s.my != nil {
		if _, err := s.my.ExecContext(context.Background(), `update app_users set blocked = ?, updated_at = utc_timestamp() where id = ?`, blocked, id); err != nil {
			return User{}, false
		}
		var user User
		err := s.my.QueryRowContext(context.Background(), `
			select id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, utc_timestamp()), coalesce(updated_at, utc_timestamp())
			from app_users where id = ?
		`, id).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
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

func (s *Store) BlockUser(blockerEmail, blockedID string) error {
	if s.db == nil && s.my == nil {
		return errors.New("database is not configured")
	}
	blocker, err := s.UserByEmail(blockerEmail)
	if err != nil {
		return err
	}
	blockedID = strings.TrimSpace(blockedID)
	if blockedID == "" || blockedID == blocker.ID {
		return errors.New("invalid user")
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `
			insert into user_blocks (blocker_id, blocked_id, created_at)
			values ($1,$2,now())
			on conflict (blocker_id, blocked_id) do nothing
		`, blocker.ID, blockedID)
		return err
	}
	_, err = s.my.ExecContext(context.Background(), `
		insert ignore into user_blocks (blocker_id, blocked_id, created_at)
		values (?,?,utc_timestamp())
	`, blocker.ID, blockedID)
	return err
}

func (s *Store) UnblockUser(blockerEmail, blockedID string) error {
	if s.db == nil && s.my == nil {
		return errors.New("database is not configured")
	}
	blocker, err := s.UserByEmail(blockerEmail)
	if err != nil {
		return err
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `delete from user_blocks where blocker_id = $1 and blocked_id = $2`, blocker.ID, strings.TrimSpace(blockedID))
		return err
	}
	_, err = s.my.ExecContext(context.Background(), `delete from user_blocks where blocker_id = ? and blocked_id = ?`, blocker.ID, strings.TrimSpace(blockedID))
	return err
}

func (s *Store) IsBlockedBetween(firstUserID, secondUserID string) bool {
	if s.db == nil && s.my == nil {
		return false
	}
	firstUserID = strings.TrimSpace(firstUserID)
	secondUserID = strings.TrimSpace(secondUserID)
	if firstUserID == "" || secondUserID == "" {
		return false
	}
	var exists bool
	if s.db != nil {
		err := s.db.QueryRow(context.Background(), `
			select exists(select 1 from user_blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1))
		`, firstUserID, secondUserID).Scan(&exists)
		return err == nil && exists
	}
	err := s.my.QueryRowContext(context.Background(), `
		select exists(select 1 from user_blocks where (blocker_id = ? and blocked_id = ?) or (blocker_id = ? and blocked_id = ?))
	`, firstUserID, secondUserID, secondUserID, firstUserID).Scan(&exists)
	return err == nil && exists
}

func (s *Store) CreateReport(reporterEmail, reportedID, messageID, reason string) (Report, error) {
	if s.db == nil && s.my == nil {
		return Report{}, errors.New("database is not configured")
	}
	reporter, err := s.UserByEmail(reporterEmail)
	if err != nil {
		return Report{}, err
	}
	report := Report{
		ID:         randomID(),
		ReporterID: reporter.ID,
		ReportedID: strings.TrimSpace(reportedID),
		MessageID:  strings.TrimSpace(messageID),
		Reason:     strings.TrimSpace(reason),
		Status:     "open",
		CreatedAt:  time.Now().UTC(),
	}
	if report.ReportedID == "" || report.ReportedID == reporter.ID {
		return Report{}, errors.New("invalid reported user")
	}
	if report.Reason == "" {
		report.Reason = "No reason provided"
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `
			insert into reports (id, reporter_id, reported_id, message_id, reason, status, created_at)
			values ($1,$2,$3,$4,$5,$6,$7)
		`, report.ID, report.ReporterID, report.ReportedID, report.MessageID, report.Reason, report.Status, report.CreatedAt)
		return report, err
	}
	_, err = s.my.ExecContext(context.Background(), `
		insert into reports (id, reporter_id, reported_id, message_id, reason, status, created_at)
		values (?,?,?,?,?,?,?)
	`, report.ID, report.ReporterID, report.ReportedID, report.MessageID, report.Reason, report.Status, report.CreatedAt)
	return report, err
}

func (s *Store) ListReports() ([]Report, error) {
	if s.db == nil && s.my == nil {
		return []Report{}, nil
	}
	query := `
		select r.id, r.reporter_id, r.reported_id, coalesce(r.message_id, ''), r.reason, r.status,
			coalesce(reporter.first_name || ' ' || reporter.last_name, ''), coalesce(reported.first_name || ' ' || reported.last_name, ''),
			r.created_at, r.resolved_at
		from reports r
		left join app_users reporter on reporter.id = r.reporter_id
		left join app_users reported on reported.id = r.reported_id
		order by r.created_at desc
	`
	var rows messageRows
	closeRows := func() {}
	var err error
	if s.db != nil {
		pgRows, queryErr := s.db.Query(context.Background(), query)
		rows, err = pgRows, queryErr
		closeRows = pgRows.Close
	} else {
		mysqlQuery := strings.ReplaceAll(query, "reporter.first_name || ' ' || reporter.last_name", "concat(reporter.first_name, ' ', reporter.last_name)")
		mysqlQuery = strings.ReplaceAll(mysqlQuery, "reported.first_name || ' ' || reported.last_name", "concat(reported.first_name, ' ', reported.last_name)")
		sqlRows, queryErr := s.my.QueryContext(context.Background(), mysqlQuery)
		rows, err = sqlRows, queryErr
		closeRows = func() { _ = sqlRows.Close() }
	}
	if err != nil {
		return nil, err
	}
	defer closeRows()

	reports := []Report{}
	for rows.Next() {
		var report Report
		if err := rows.Scan(&report.ID, &report.ReporterID, &report.ReportedID, &report.MessageID, &report.Reason, &report.Status, &report.ReporterName, &report.ReportedName, &report.CreatedAt, &report.ResolvedAt); err != nil {
			return nil, err
		}
		report.ReporterName = strings.TrimSpace(report.ReporterName)
		report.ReportedName = strings.TrimSpace(report.ReportedName)
		reports = append(reports, report)
	}
	return reports, rows.Err()
}

func (s *Store) ResolveReport(id string) error {
	if s.db == nil && s.my == nil {
		return errors.New("database is not configured")
	}
	if s.db != nil {
		result, err := s.db.Exec(context.Background(), `update reports set status = 'resolved', resolved_at = now() where id = $1`, strings.TrimSpace(id))
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return errors.New("report not found")
		}
		return nil
	}
	result, err := s.my.ExecContext(context.Background(), `update reports set status = 'resolved', resolved_at = utc_timestamp() where id = ?`, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return errors.New("report not found")
	}
	return nil
}

func (s *Store) SaveMessage(senderEmail, recipientID, body, attachmentName, attachmentType, attachmentKind, attachmentURL string) (Message, error) {
	if s.db == nil && s.my == nil {
		return Message{}, errors.New("database is not configured")
	}
	sender, err := s.UserByEmail(senderEmail)
	if err != nil {
		return Message{}, err
	}
	recipient, err := s.UserByID(recipientID)
	if err != nil {
		return Message{}, errors.New("recipient not found")
	}
	if s.IsBlockedBetween(sender.ID, recipient.ID) {
		return Message{}, errors.New("messaging is blocked between these users")
	}
	message := Message{
		ID:             randomID(),
		ConversationID: conversationID(sender.ID, recipient.ID),
		SenderEmail:    sender.Email,
		SenderID:       sender.ID,
		RecipientID:    recipient.ID,
		Body:           strings.TrimSpace(body),
		AttachmentName: strings.TrimSpace(attachmentName),
		AttachmentType: strings.TrimSpace(attachmentType),
		AttachmentKind: strings.TrimSpace(attachmentKind),
		AttachmentURL:  strings.TrimSpace(attachmentURL),
		CreatedAt:      time.Now().UTC(),
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `
			insert into messages (id, conversation_id, sender_email, sender_id, recipient_id, body, attachment_name, attachment_type, attachment_kind, attachment_url, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		`, message.ID, message.ConversationID, message.SenderEmail, message.SenderID, message.RecipientID, message.Body, message.AttachmentName, message.AttachmentType, message.AttachmentKind, message.AttachmentURL, message.CreatedAt)
	} else {
		_, err = s.my.ExecContext(context.Background(), `
			insert into messages (id, conversation_id, sender_email, sender_id, recipient_id, body, attachment_name, attachment_type, attachment_kind, attachment_url, created_at)
			values (?,?,?,?,?,?,?,?,?,?,?)
		`, message.ID, message.ConversationID, message.SenderEmail, message.SenderID, message.RecipientID, message.Body, message.AttachmentName, message.AttachmentType, message.AttachmentKind, message.AttachmentURL, message.CreatedAt)
	}
	return message, err
}

func (s *Store) SaveAttachment(ownerEmail, name, contentType, kind string, content []byte) (Attachment, error) {
	if s.db == nil && s.my == nil {
		return Attachment{}, errors.New("database is not configured")
	}
	owner, err := s.UserByEmail(ownerEmail)
	if err != nil {
		return Attachment{}, err
	}
	attachment := Attachment{
		ID:          randomID(),
		OwnerID:     owner.ID,
		Name:        strings.TrimSpace(name),
		ContentType: strings.TrimSpace(contentType),
		Kind:        strings.TrimSpace(kind),
		SizeBytes:   int64(len(content)),
		Content:     content,
		CreatedAt:   time.Now().UTC(),
	}
	if attachment.Name == "" {
		attachment.Name = "attachment"
	}
	if attachment.ContentType == "" {
		attachment.ContentType = "application/octet-stream"
	}
	if attachment.Kind == "" {
		attachment.Kind = "file"
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `
			insert into attachments (id, owner_id, name, content_type, kind, size_bytes, content, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8)
		`, attachment.ID, attachment.OwnerID, attachment.Name, attachment.ContentType, attachment.Kind, attachment.SizeBytes, attachment.Content, attachment.CreatedAt)
		return attachment, err
	}
	_, err = s.my.ExecContext(context.Background(), `
		insert into attachments (id, owner_id, name, content_type, kind, size_bytes, content, created_at)
		values (?,?,?,?,?,?,?,?)
	`, attachment.ID, attachment.OwnerID, attachment.Name, attachment.ContentType, attachment.Kind, attachment.SizeBytes, attachment.Content, attachment.CreatedAt)
	return attachment, err
}

func (s *Store) AttachmentByID(requesterEmail, id string) (Attachment, error) {
	if s.db == nil && s.my == nil {
		return Attachment{}, errors.New("database is not configured")
	}
	requester, err := s.UserByEmail(requesterEmail)
	if err != nil {
		return Attachment{}, err
	}
	id = strings.TrimSpace(id)
	reference := "attachment:" + id
	var attachment Attachment
	if s.db != nil {
		err = s.db.QueryRow(context.Background(), `
			select a.id, a.owner_id, a.name, a.content_type, a.kind, a.size_bytes, a.content, a.created_at
			from attachments a
			where a.id = $1
			  and (
				a.owner_id = $2
				or exists (
					select 1 from messages m
					where m.attachment_url = $3
					  and (m.sender_email = $4 or m.recipient_id = $2)
				)
			  )
		`, id, requester.ID, reference, requester.Email).Scan(&attachment.ID, &attachment.OwnerID, &attachment.Name, &attachment.ContentType, &attachment.Kind, &attachment.SizeBytes, &attachment.Content, &attachment.CreatedAt)
		return attachment, err
	}
	err = s.my.QueryRowContext(context.Background(), `
		select a.id, a.owner_id, a.name, a.content_type, a.kind, a.size_bytes, a.content, a.created_at
		from attachments a
		where a.id = ?
		  and (
			a.owner_id = ?
			or exists (
				select 1 from messages m
				where m.attachment_url = ?
				  and (m.sender_email = ? or m.recipient_id = ?)
			)
		  )
	`, id, requester.ID, reference, requester.Email, requester.ID).Scan(&attachment.ID, &attachment.OwnerID, &attachment.Name, &attachment.ContentType, &attachment.Kind, &attachment.SizeBytes, &attachment.Content, &attachment.CreatedAt)
	return attachment, err
}

func (s *Store) ListMessages(userEmail, otherUserID string, limit int) ([]Message, error) {
	if s.db == nil && s.my == nil {
		return []Message{}, nil
	}
	user, err := s.UserByEmail(userEmail)
	if err != nil {
		return nil, err
	}
	other, otherErr := s.UserByID(otherUserID)
	otherID := strings.TrimSpace(otherUserID)
	otherEmail := ""
	if otherErr == nil {
		otherID = other.ID
		otherEmail = other.Email
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		select m.id, coalesce(m.conversation_id, ''), coalesce(m.sender_email, ''), coalesce(nullif(m.sender_id, ''), u.id, ''), coalesce(m.recipient_id, ''), coalesce(m.body, ''), coalesce(m.attachment_name, ''), coalesce(m.attachment_type, ''), coalesce(m.attachment_kind, ''), coalesce(m.attachment_url, ''), coalesce(m.created_at, now()), m.read_at
		from messages m
		left join app_users u on u.email = m.sender_email
		where coalesce(m.conversation_id, '') = %s
		   or (lower(coalesce(m.sender_email, '')) = %s and coalesce(m.recipient_id, '') = %s)
		   or (%s <> '' and lower(coalesce(m.sender_email, '')) = %s and coalesce(m.recipient_id, '') = %s)
		   or (coalesce(m.sender_id, '') = %s and coalesce(m.recipient_id, '') = %s)
		order by m.created_at desc
		limit %s
	`
	var rows messageRows
	closeRows := func() {}
	if s.db != nil {
		pgRows, queryErr := s.db.Query(context.Background(), fmt.Sprintf(query, "$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9"), conversationID(user.ID, otherID), user.Email, otherID, otherEmail, otherEmail, user.ID, otherID, user.ID, limit)
		rows, err = pgRows, queryErr
		closeRows = pgRows.Close
	} else {
		sqlRows, queryErr := s.my.QueryContext(context.Background(), fmt.Sprintf(query, "?", "?", "?", "?", "?", "?", "?", "?", "?"), conversationID(user.ID, otherID), user.Email, otherID, otherEmail, otherEmail, user.ID, otherID, user.ID, limit)
		rows, err = sqlRows, queryErr
		closeRows = func() { _ = sqlRows.Close() }
	}
	if err != nil {
		return nil, err
	}
	defer closeRows()

	messages := []Message{}
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.SenderEmail, &message.SenderID, &message.RecipientID, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt, &message.ReadAt); err != nil {
			return nil, err
		}
		messages = append([]Message{message}, messages...)
	}
	return messages, rows.Err()
}

func (s *Store) ListInboxMessages(userEmail string, limit int) ([]Message, error) {
	if s.db == nil && s.my == nil {
		return []Message{}, nil
	}
	user, err := s.UserByEmail(userEmail)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 300 {
		limit = 200
	}
	query := `
		select m.id, coalesce(m.conversation_id, ''), coalesce(m.sender_email, ''), coalesce(nullif(m.sender_id, ''), u.id, ''), coalesce(m.recipient_id, ''), coalesce(m.body, ''), coalesce(m.attachment_name, ''), coalesce(m.attachment_type, ''), coalesce(m.attachment_kind, ''), coalesce(m.attachment_url, ''), coalesce(m.created_at, now()), m.read_at
		from messages m
		left join app_users u on u.email = m.sender_email
		where lower(coalesce(m.sender_email, '')) = %s or coalesce(m.recipient_id, '') = %s
		order by m.created_at desc
		limit %s
	`
	var rows messageRows
	closeRows := func() {}
	if s.db != nil {
		pgRows, queryErr := s.db.Query(context.Background(), fmt.Sprintf(query, "$1", "$2", "$3"), strings.ToLower(strings.TrimSpace(userEmail)), user.ID, limit)
		rows, err = pgRows, queryErr
		closeRows = pgRows.Close
	} else {
		sqlRows, queryErr := s.my.QueryContext(context.Background(), fmt.Sprintf(query, "?", "?", "?"), strings.ToLower(strings.TrimSpace(userEmail)), user.ID, limit)
		rows, err = sqlRows, queryErr
		closeRows = func() { _ = sqlRows.Close() }
	}
	if err != nil {
		return nil, err
	}
	defer closeRows()

	messages := []Message{}
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.SenderEmail, &message.SenderID, &message.RecipientID, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt, &message.ReadAt); err != nil {
			return nil, err
		}
		messages = append([]Message{message}, messages...)
	}
	return messages, rows.Err()
}

func (s *Store) MarkConversationRead(userEmail, otherUserID string) error {
	if s.db == nil && s.my == nil {
		return nil
	}
	user, err := s.UserByEmail(userEmail)
	if err != nil {
		return err
	}
	conversation := conversationID(user.ID, otherUserID)
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `
			update messages set read_at = coalesce(read_at, now())
			where conversation_id = $1 and recipient_id = $2
		`, conversation, user.ID)
		return err
	}
	_, err = s.my.ExecContext(context.Background(), `
		update messages set read_at = coalesce(read_at, utc_timestamp())
		where conversation_id = ? and recipient_id = ?
	`, conversation, user.ID)
	return err
}

func (s *Store) UpdateMessage(userEmail, id, body string) (Message, error) {
	if s.db == nil && s.my == nil {
		return Message{}, errors.New("database is not configured")
	}
	email := strings.ToLower(strings.TrimSpace(userEmail))
	if s.db != nil {
		_, err := s.db.Exec(context.Background(), `update messages set body = $2 where id = $1 and sender_email = $3`, id, strings.TrimSpace(body), email)
		if err != nil {
			return Message{}, err
		}
		return s.messageByID(id)
	}
	_, err := s.my.ExecContext(context.Background(), `update messages set body = ? where id = ? and sender_email = ?`, strings.TrimSpace(body), id, email)
	if err != nil {
		return Message{}, err
	}
	return s.messageByID(id)
}

func (s *Store) DeleteMessage(userEmail, id string) error {
	if s.db == nil && s.my == nil {
		return errors.New("database is not configured")
	}
	email := strings.ToLower(strings.TrimSpace(userEmail))
	if s.db != nil {
		result, err := s.db.Exec(context.Background(), `delete from messages where id = $1 and sender_email = $2`, id, email)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return errors.New("message not found")
		}
		return nil
	}
	result, err := s.my.ExecContext(context.Background(), `delete from messages where id = ? and sender_email = ?`, id, email)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return errors.New("message not found")
	}
	return nil
}

func (s *Store) migrate(ctx context.Context) error {
	if s.my != nil {
		statements := []string{
			`
			create table if not exists app_users (
				id varchar(64) primary key,
				email varchar(255) unique not null,
				first_name varchar(255) not null,
				last_name varchar(255) not null default '',
				password_hash varchar(255) not null,
				avatar_url mediumtext not null,
				blocked boolean not null default false,
				created_at datetime not null default current_timestamp,
				updated_at datetime not null default current_timestamp
			)`,
			`
			create table if not exists messages (
				id varchar(64) primary key,
				conversation_id varchar(255) not null,
				sender_email varchar(255) not null,
				sender_id varchar(64) not null default '',
				recipient_id varchar(64) not null,
				body text not null,
				attachment_name text not null,
				attachment_type text not null,
				attachment_kind varchar(32) not null,
				attachment_url mediumtext not null,
				read_at datetime null,
				created_at datetime not null default current_timestamp
			)`,
			`
			create table if not exists user_blocks (
				blocker_id varchar(64) not null,
				blocked_id varchar(64) not null,
				created_at datetime not null default current_timestamp,
				primary key (blocker_id, blocked_id)
			)`,
			`
			create table if not exists reports (
				id varchar(64) primary key,
				reporter_id varchar(64) not null,
				reported_id varchar(64) not null,
				message_id varchar(64) not null default '',
				reason text not null,
				status varchar(32) not null default 'open',
				created_at datetime not null default current_timestamp,
				resolved_at datetime null
			)`,
			`
			create table if not exists attachments (
				id varchar(64) primary key,
				owner_id varchar(64) not null,
				name text not null,
				content_type varchar(255) not null,
				kind varchar(32) not null,
				size_bytes bigint not null,
				content longblob not null,
				created_at datetime not null default current_timestamp
			)`,
		}
		for _, statement := range statements {
			if _, err := s.my.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
		_, _ = s.my.ExecContext(ctx, `alter table app_users add column last_name varchar(255) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table app_users add column first_name varchar(255) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table app_users add column password_hash varchar(255) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table app_users add column avatar_url mediumtext null`)
		_, _ = s.my.ExecContext(ctx, `alter table app_users add column blocked boolean not null default false`)
		_, _ = s.my.ExecContext(ctx, `alter table app_users add column created_at datetime not null default current_timestamp`)
		_, _ = s.my.ExecContext(ctx, `alter table app_users add column updated_at datetime not null default current_timestamp`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column conversation_id varchar(255) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column sender_email varchar(255) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column sender_id varchar(64) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column recipient_id varchar(64) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column body text null`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column attachment_name text null`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column attachment_type text null`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column attachment_kind varchar(32) null`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column attachment_url mediumtext null`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column read_at datetime null`)
		_, _ = s.my.ExecContext(ctx, `alter table messages add column created_at datetime not null default current_timestamp`)
		_, _ = s.my.ExecContext(ctx, `alter table attachments add column size_bytes bigint not null default 0`)
		_, _ = s.my.ExecContext(ctx, `
			update app_users set
				first_name = coalesce(first_name, ''),
				last_name = coalesce(last_name, ''),
				password_hash = coalesce(password_hash, ''),
				avatar_url = coalesce(avatar_url, ''),
				blocked = coalesce(blocked, false),
				created_at = coalesce(created_at, utc_timestamp()),
				updated_at = coalesce(updated_at, utc_timestamp())
		`)
		_, _ = s.my.ExecContext(ctx, `
			update messages set
				conversation_id = coalesce(conversation_id, ''),
				sender_email = coalesce(sender_email, ''),
				sender_id = coalesce(sender_id, ''),
				recipient_id = coalesce(recipient_id, ''),
				body = coalesce(body, ''),
				attachment_name = coalesce(attachment_name, ''),
				attachment_type = coalesce(attachment_type, ''),
				attachment_kind = coalesce(attachment_kind, ''),
				attachment_url = coalesce(attachment_url, ''),
				created_at = coalesce(created_at, utc_timestamp())
		`)
		_, _ = s.my.ExecContext(ctx, `
			update messages m
			join app_users u on lower(u.email) = lower(m.sender_email)
			set m.sender_id = u.id
			where coalesce(m.sender_id, '') = ''
		`)
		_, _ = s.my.ExecContext(ctx, `create index idx_messages_conversation_created on messages (conversation_id, created_at)`)
		_, _ = s.my.ExecContext(ctx, `create index idx_attachments_owner on attachments (owner_id)`)
		return nil
	}
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
			sender_id text not null default '',
			recipient_id text not null,
			body text not null default '',
			attachment_name text not null default '',
			attachment_type text not null default '',
			attachment_kind text not null default '',
			attachment_url text not null default '',
			read_at timestamptz null,
			created_at timestamptz not null default now()
		);
		create index if not exists idx_messages_conversation_created on messages (conversation_id, created_at);
		create table if not exists user_blocks (
			blocker_id text not null,
			blocked_id text not null,
			created_at timestamptz not null default now(),
			primary key (blocker_id, blocked_id)
		);
		create table if not exists reports (
			id text primary key,
			reporter_id text not null,
			reported_id text not null,
			message_id text not null default '',
			reason text not null,
			status text not null default 'open',
			created_at timestamptz not null default now(),
			resolved_at timestamptz null
		);
		create table if not exists attachments (
			id text primary key,
			owner_id text not null,
			name text not null,
			content_type text not null,
			kind text not null,
			size_bytes bigint not null,
			content bytea not null,
			created_at timestamptz not null default now()
		);
		create index if not exists idx_attachments_owner on attachments (owner_id);
	`)
	if err != nil {
		return err
	}
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists attachment_url text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists read_at timestamptz null`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists conversation_id text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists sender_email text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists sender_id text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists recipient_id text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists body text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists attachment_name text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists attachment_type text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists attachment_kind text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists created_at timestamptz not null default now()`)
	_, _ = s.db.Exec(ctx, `alter table app_users add column if not exists first_name text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table app_users add column if not exists last_name text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table app_users add column if not exists password_hash text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table app_users add column if not exists avatar_url text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table app_users add column if not exists blocked boolean not null default false`)
	_, _ = s.db.Exec(ctx, `alter table app_users add column if not exists created_at timestamptz not null default now()`)
	_, _ = s.db.Exec(ctx, `alter table app_users add column if not exists updated_at timestamptz not null default now()`)
	_, _ = s.db.Exec(ctx, `alter table attachments add column if not exists size_bytes bigint not null default 0`)
	_, _ = s.db.Exec(ctx, `
		update app_users set
			first_name = coalesce(first_name, ''),
			last_name = coalesce(last_name, ''),
			password_hash = coalesce(password_hash, ''),
			avatar_url = coalesce(avatar_url, ''),
			blocked = coalesce(blocked, false),
			created_at = coalesce(created_at, now()),
			updated_at = coalesce(updated_at, now())
	`)
	_, _ = s.db.Exec(ctx, `
		update messages set
			conversation_id = coalesce(conversation_id, ''),
			sender_email = coalesce(sender_email, ''),
			sender_id = coalesce(sender_id, ''),
			recipient_id = coalesce(recipient_id, ''),
			body = coalesce(body, ''),
			attachment_name = coalesce(attachment_name, ''),
			attachment_type = coalesce(attachment_type, ''),
			attachment_kind = coalesce(attachment_kind, ''),
			attachment_url = coalesce(attachment_url, ''),
			created_at = coalesce(created_at, now())
	`)
	_, _ = s.db.Exec(ctx, `
		update messages m
		set sender_id = u.id
		from app_users u
		where lower(u.email) = lower(m.sender_email)
		  and coalesce(m.sender_id, '') = ''
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
		returning id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, now()), coalesce(updated_at, now())
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
		select id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, now()), coalesce(updated_at, now())
		from app_users where email = $1
	`, strings.ToLower(strings.TrimSpace(email))).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func (s *Store) userByIDDB(id string) (User, error) {
	var user User
	err := s.db.QueryRow(context.Background(), `
		select id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, now()), coalesce(updated_at, now())
		from app_users where id = $1
	`, strings.TrimSpace(id)).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func (s *Store) upsertUserMySQL(email, firstName, lastName, password, avatarURL string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	id := randomID()
	_, err = s.my.ExecContext(context.Background(), `
		insert into app_users (id, email, first_name, last_name, password_hash, avatar_url)
		values (?,?,?,?,?,?)
		on duplicate key update
			first_name = values(first_name),
			last_name = values(last_name),
			password_hash = values(password_hash),
			avatar_url = case when values(avatar_url) = '' then avatar_url else values(avatar_url) end,
			updated_at = utc_timestamp()
	`, id, email, strings.TrimSpace(firstName), strings.TrimSpace(lastName), string(passwordHash), avatarURL)
	if err != nil {
		return User{}, err
	}
	return s.UserByEmail(email)
}

func (s *Store) authenticateMySQL(email, password string) (User, error) {
	user, err := s.userByEmailMySQL(email)
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

func (s *Store) userByEmailMySQL(email string) (User, error) {
	var user User
	err := s.my.QueryRowContext(context.Background(), `
		select id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, utc_timestamp()), coalesce(updated_at, utc_timestamp())
		from app_users where email = ?
	`, strings.ToLower(strings.TrimSpace(email))).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func (s *Store) userByIDMySQL(id string) (User, error) {
	var user User
	err := s.my.QueryRowContext(context.Background(), `
		select id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, utc_timestamp()), coalesce(updated_at, utc_timestamp())
		from app_users where id = ?
	`, strings.TrimSpace(id)).Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.PasswordHash, &user.AvatarURL, &user.Blocked, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func (s *Store) searchUsersMySQL(query string, includeBlocked bool, limit int) ([]User, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.my.QueryContext(context.Background(), `
		select id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, utc_timestamp()), coalesce(updated_at, utc_timestamp())
		from app_users
		where (? = '' or lower(concat(first_name, ' ', last_name)) like concat('%', ?, '%') or lower(email) like concat('%', ?, '%'))
		  and (? = true or blocked = false)
		order by created_at desc
		limit ?
	`, query, query, query, includeBlocked, limit)
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

func (s *Store) searchUsersDB(query string, includeBlocked bool, limit int) ([]User, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.db.Query(context.Background(), `
		select id, email, coalesce(first_name, ''), coalesce(last_name, ''), coalesce(password_hash, ''), coalesce(avatar_url, ''), coalesce(blocked, false), coalesce(created_at, now()), coalesce(updated_at, now())
		from app_users
		where (length($1::text) = 0 or lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) like '%' || $1::text || '%' or lower(email) like '%' || $1::text || '%')
		  and ($2::boolean = true or blocked = false)
		order by created_at desc
		limit $3
	`, query, includeBlocked, limit)
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

func (s *Store) messageByID(id string) (Message, error) {
	query := `
		select m.id, coalesce(m.conversation_id, ''), coalesce(m.sender_email, ''), coalesce(nullif(m.sender_id, ''), u.id, ''), coalesce(m.recipient_id, ''), coalesce(m.body, ''), coalesce(m.attachment_name, ''), coalesce(m.attachment_type, ''), coalesce(m.attachment_kind, ''), coalesce(m.attachment_url, ''), coalesce(m.created_at, now()), m.read_at
		from messages m
		left join app_users u on u.email = m.sender_email
		where m.id = %s
	`
	var message Message
	if s.db != nil {
		err := s.db.QueryRow(context.Background(), fmt.Sprintf(query, "$1"), id).Scan(&message.ID, &message.ConversationID, &message.SenderEmail, &message.SenderID, &message.RecipientID, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt, &message.ReadAt)
		return message, err
	}
	err := s.my.QueryRowContext(context.Background(), fmt.Sprintf(query, "?"), id).Scan(&message.ID, &message.ConversationID, &message.SenderEmail, &message.SenderID, &message.RecipientID, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt, &message.ReadAt)
	return message, err
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
