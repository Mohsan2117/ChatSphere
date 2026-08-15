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
	Users         []User                    `json:"users"`
	AIUsage       map[string]map[string]int `json:"aiUsage,omitempty"`
	CallHistory   []CallHistory             `json:"callHistory,omitempty"`
	Statuses      []Status                  `json:"statuses,omitempty"`
	StatusViews   []StatusView              `json:"statusViews,omitempty"`
	Groups        []Group                   `json:"groups,omitempty"`
	GroupMembers  []GroupMember             `json:"groupMembers,omitempty"`
	GroupMessages []GroupMessage            `json:"groupMessages,omitempty"`
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

type CallHistory struct {
	ID              string     `json:"id"`
	CallerID        string     `json:"callerId"`
	RecipientID     string     `json:"recipientId"`
	CallType        string     `json:"callType"`
	Status          string     `json:"status"`
	StartedAt       time.Time  `json:"startedAt"`
	AnsweredAt      *time.Time `json:"answeredAt,omitempty"`
	EndedAt         *time.Time `json:"endedAt,omitempty"`
	DurationSeconds int        `json:"durationSeconds"`
}

type Status struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	Type       string    `json:"type"`
	Text       string    `json:"textContent,omitempty"`
	MediaURL   string    `json:"mediaUrl,omitempty"`
	Caption    string    `json:"caption,omitempty"`
	Background string    `json:"background,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

type StatusView struct {
	StatusID string    `json:"statusId"`
	ViewerID string    `json:"viewerId"`
	ViewedAt time.Time `json:"viewedAt"`
}

type StatusWithUser struct {
	Status
	User     User
	IsViewed bool
}

type StatusViewer struct {
	User     User      `json:"user"`
	ViewedAt time.Time `json:"viewedAt"`
}

type Group struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	OwnerID   string    `json:"ownerId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type GroupMember struct {
	GroupID  string    `json:"groupId"`
	UserID   string    `json:"userId"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joinedAt"`
}

type GroupMessage struct {
	ID             string    `json:"id"`
	GroupID        string    `json:"groupId"`
	SenderID       string    `json:"senderId"`
	SenderEmail    string    `json:"senderEmail"`
	Body           string    `json:"body"`
	AttachmentName string    `json:"attachmentName,omitempty"`
	AttachmentType string    `json:"attachmentType,omitempty"`
	AttachmentKind string    `json:"attachmentKind,omitempty"`
	AttachmentURL  string    `json:"attachmentUrl,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

type GroupMemberView struct {
	GroupMember
	User User `json:"user"`
}

type GroupSummary struct {
	Group
	Role          string        `json:"role"`
	MemberCount   int           `json:"memberCount"`
	LatestMessage *GroupMessage `json:"latestMessage,omitempty"`
}

type GroupDetails struct {
	GroupSummary
	Members []GroupMemberView `json:"members"`
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
	ID                 string    `json:"id"`
	OwnerID            string    `json:"ownerId"`
	Name               string    `json:"name"`
	ContentType        string    `json:"contentType"`
	Kind               string    `json:"kind"`
	SizeBytes          int64     `json:"sizeBytes"`
	Content            []byte    `json:"-"`
	CloudinaryURL      string    `json:"cloudinaryUrl,omitempty"`
	CloudinaryPublicID string    `json:"cloudinaryPublicId,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
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

// Ping runs a lightweight query SELECT 1 to verify that the database is reachable and active.
func (s *Store) Ping(ctx context.Context) error {
	if s.db != nil {
		var one int
		return s.db.QueryRow(ctx, "SELECT 1").Scan(&one)
	}
	if s.my != nil {
		var one int
		return s.my.QueryRowContext(ctx, "SELECT 1").Scan(&one)
	}
	return nil
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

	email = strings.ToLower(strings.TrimSpace(email))
	now := time.Now().UTC()
	// Generate the bcrypt hash before acquiring the lock so that the
	// expensive computation does not block concurrent login attempts.
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

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

	email = strings.ToLower(strings.TrimSpace(email))

	// Copy the user record under the lock, then release the lock before the
	// expensive bcrypt comparison. This prevents concurrent login attempts
	// from being serialized behind a single bcrypt computation.
	s.mu.Lock()
	var match *User
	for index := range s.data.Users {
		if s.data.Users[index].Email == email {
			match = &s.data.Users[index]
			break
		}
	}
	s.mu.Unlock()

	if match == nil {
		return User{}, errors.New("invalid email or password")
	}
	if match.Blocked {
		return User{}, errors.New("account blocked")
	}
	if bcrypt.CompareHashAndPassword([]byte(match.PasswordHash), []byte(password)) != nil {
		return User{}, errors.New("invalid email or password")
	}
	return *match, nil
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

func (s *Store) SaveMessage(clientMsgID, senderEmail, recipientID, body, attachmentName, attachmentType, attachmentKind, attachmentURL string) (Message, error) {
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
	msgID := clientMsgID
	if msgID == "" {
		msgID = randomID()
	}
	message := Message{
		ID:             msgID,
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

func (s *Store) SaveCloudinaryAttachment(ownerEmail, name, contentType, kind string, sizeBytes int64, cloudinaryURL, cloudinaryPublicID string) (Attachment, error) {
	if s.db == nil && s.my == nil {
		return Attachment{}, errors.New("database is not configured")
	}
	owner, err := s.UserByEmail(ownerEmail)
	if err != nil {
		return Attachment{}, err
	}
	attachment := Attachment{
		ID:                 randomID(),
		OwnerID:            owner.ID,
		Name:               strings.TrimSpace(name),
		ContentType:        strings.TrimSpace(contentType),
		Kind:               strings.TrimSpace(kind),
		SizeBytes:          sizeBytes,
		Content:            []byte{},
		CloudinaryURL:      cloudinaryURL,
		CloudinaryPublicID: cloudinaryPublicID,
		CreatedAt:          time.Now().UTC(),
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
			insert into attachments (id, owner_id, name, content_type, kind, size_bytes, content, cloudinary_url, cloudinary_public_id, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		`, attachment.ID, attachment.OwnerID, attachment.Name, attachment.ContentType, attachment.Kind, attachment.SizeBytes, attachment.Content, attachment.CloudinaryURL, attachment.CloudinaryPublicID, attachment.CreatedAt)
		return attachment, err
	}
	_, err = s.my.ExecContext(context.Background(), `
		insert into attachments (id, owner_id, name, content_type, kind, size_bytes, content, cloudinary_url, cloudinary_public_id, created_at)
		values (?,?,?,?,?,?,?,?,?,?)
	`, attachment.ID, attachment.OwnerID, attachment.Name, attachment.ContentType, attachment.Kind, attachment.SizeBytes, attachment.Content, attachment.CloudinaryURL, attachment.CloudinaryPublicID, attachment.CreatedAt)
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
			select a.id, a.owner_id, a.name, a.content_type, a.kind, a.size_bytes, a.content, coalesce(a.cloudinary_url, ''), coalesce(a.cloudinary_public_id, ''), a.created_at
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
		`, id, requester.ID, reference, requester.Email).Scan(&attachment.ID, &attachment.OwnerID, &attachment.Name, &attachment.ContentType, &attachment.Kind, &attachment.SizeBytes, &attachment.Content, &attachment.CloudinaryURL, &attachment.CloudinaryPublicID, &attachment.CreatedAt)
		return attachment, err
	}
	err = s.my.QueryRowContext(context.Background(), `
		select a.id, a.owner_id, a.name, a.content_type, a.kind, a.size_bytes, a.content, coalesce(a.cloudinary_url, ''), coalesce(a.cloudinary_public_id, ''), a.created_at
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
	`, id, requester.ID, reference, requester.Email, requester.ID).Scan(&attachment.ID, &attachment.OwnerID, &attachment.Name, &attachment.ContentType, &attachment.Kind, &attachment.SizeBytes, &attachment.Content, &attachment.CloudinaryURL, &attachment.CloudinaryPublicID, &attachment.CreatedAt)
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
		order by m.created_at desc, m.seq desc
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
		order by m.created_at desc, m.seq desc
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
		return s.MessageByID(id)
	}
	_, err := s.my.ExecContext(context.Background(), `update messages set body = ? where id = ? and sender_email = ?`, strings.TrimSpace(body), id, email)
	if err != nil {
		return Message{}, err
	}
	return s.MessageByID(id)
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

func (s *Store) ClearConversation(userEmail, otherUserID string) error {
	if s.db == nil && s.my == nil {
		return errors.New("database is not configured")
	}
	user, err := s.UserByEmail(userEmail)
	if err != nil {
		return err
	}
	other, err := s.UserByID(otherUserID)
	if err != nil {
		return errors.New("other user not found")
	}

	convID := conversationID(user.ID, other.ID)

	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `
			delete from messages
			where coalesce(conversation_id, '') = $1
			   or (sender_id = $2 and recipient_id = $3)
			   or (sender_id = $3 and recipient_id = $2)
			   or (lower(sender_email) = lower($4) and recipient_id = $3)
			   or (lower(sender_email) = lower($5) and recipient_id = $2)
		`, convID, user.ID, other.ID, user.Email, other.Email)
		return err
	}

	_, err = s.my.ExecContext(context.Background(), `
		delete from messages
		where coalesce(conversation_id, '') = ?
		   or (sender_id = ? and recipient_id = ?)
		   or (sender_id = ? and recipient_id = ?)
		   or (lower(sender_email) = lower(?) and recipient_id = ?)
		   or (lower(sender_email) = lower(?) and recipient_id = ?)
	`, convID, user.ID, other.ID, other.ID, user.ID, user.Email, other.ID, other.Email, user.ID)
	return err
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
				seq bigint auto_increment unique,
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
			`
			create table if not exists ai_usage (
				user_id varchar(64) not null,
				usage_date varchar(10) not null,
				request_count bigint not null default 0,
				primary key (user_id, usage_date)
			)`,
			`
			create table if not exists call_history (
				id varchar(255) primary key,
				caller_id varchar(64) not null,
				recipient_id varchar(64) not null,
				call_type varchar(16) not null default 'audio',
				status varchar(16) not null default 'ringing',
				started_at datetime not null default current_timestamp,
				answered_at datetime,
				ended_at datetime,
				duration_seconds int not null default 0
			)`,
			`
			create table if not exists statuses (
				id varchar(64) primary key,
				user_id varchar(64) not null,
				type varchar(16) not null,
				text_content text not null,
				media_url mediumtext not null,
				caption text not null,
				background varchar(32) not null,
				created_at datetime not null default current_timestamp,
				expires_at datetime not null,
				index statuses_user_expiry (user_id, expires_at)
			)`,
			`
			create table if not exists status_views (
				status_id varchar(64) not null,
				viewer_id varchar(64) not null,
				viewed_at datetime not null default current_timestamp,
				primary key (status_id, viewer_id)
			)`,
			`
			create table if not exists groups (
				id varchar(64) primary key,
				name varchar(255) not null,
				avatar_url mediumtext not null,
				owner_id varchar(64) not null,
				created_at datetime not null default current_timestamp,
				updated_at datetime not null default current_timestamp
			)`,
			`
			create table if not exists group_members (
				group_id varchar(64) not null,
				user_id varchar(64) not null,
				role varchar(16) not null default 'member',
				joined_at datetime not null default current_timestamp,
				primary key (group_id, user_id)
			)`,
			`
			create table if not exists group_messages (
				id varchar(64) primary key,
				group_id varchar(64) not null,
				sender_id varchar(64) not null,
				sender_email varchar(255) not null,
				body text not null,
				attachment_name text not null,
				attachment_type text not null,
				attachment_kind varchar(32) not null,
				attachment_url mediumtext not null,
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
		_, _ = s.my.ExecContext(ctx, `alter table messages add column seq bigint auto_increment unique`)
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
		_, _ = s.my.ExecContext(ctx, `alter table attachments add column cloudinary_url text null`)
		_, _ = s.my.ExecContext(ctx, `alter table attachments add column cloudinary_public_id varchar(255) null`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column caller_id varchar(64) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column recipient_id varchar(64) not null default ''`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column call_type varchar(16) not null default 'audio'`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column status varchar(16) not null default 'ringing'`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column started_at datetime not null default current_timestamp`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column answered_at datetime null`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column ended_at datetime null`)
		_, _ = s.my.ExecContext(ctx, `alter table call_history add column duration_seconds int not null default 0`)
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
		_, _ = s.my.ExecContext(ctx, `create index idx_messages_conversation_created on messages (conversation_id, created_at, seq)`)
		_, _ = s.my.ExecContext(ctx, `create index idx_attachments_owner on attachments (owner_id)`)
		_, _ = s.my.ExecContext(ctx, `create index idx_call_history_caller on call_history(caller_id)`)
		_, _ = s.my.ExecContext(ctx, `create index idx_call_history_recipient on call_history(recipient_id)`)
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
			seq bigserial,
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
		create table if not exists ai_usage (
			user_id text not null,
			usage_date text not null,
			request_count bigint not null default 0,
			primary key (user_id, usage_date)
		);
		create table if not exists call_history (
			id text primary key,
			caller_id text not null,
			recipient_id text not null,
			call_type text not null default 'audio',
			status text not null default 'ringing',
			started_at timestamptz not null default now(),
			answered_at timestamptz,
			ended_at timestamptz,
			duration_seconds integer not null default 0
		);
		create index if not exists idx_call_history_caller on call_history(caller_id);
		create index if not exists idx_call_history_recipient on call_history(recipient_id);
		create table if not exists statuses (
			id text primary key,
			user_id text not null,
			type text not null,
			text_content text not null default '',
			media_url text not null default '',
			caption text not null default '',
			background text not null default '',
			created_at timestamptz not null default now(),
			expires_at timestamptz not null
		);
		create index if not exists statuses_user_expiry on statuses(user_id, expires_at);
		create table if not exists status_views (
			status_id text not null,
			viewer_id text not null,
			viewed_at timestamptz not null default now(),
			primary key (status_id, viewer_id)
		);
		create table if not exists groups (
			id text primary key,
			name text not null,
			avatar_url text not null default '',
			owner_id text not null,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists group_members (
			group_id text not null,
			user_id text not null,
			role text not null default 'member',
			joined_at timestamptz not null default now(),
			primary key (group_id, user_id)
		);
		create table if not exists group_messages (
			id text primary key,
			group_id text not null,
			sender_id text not null,
			sender_email text not null,
			body text not null default '',
			attachment_name text not null default '',
			attachment_type text not null default '',
			attachment_kind text not null default '',
			attachment_url text not null default '',
			created_at timestamptz not null default now()
		);
		create index if not exists group_messages_group_created on group_messages(group_id, created_at);
	`)
	if err != nil {
		return err
	}
	_, _ = s.db.Exec(ctx, `alter table messages add column if not exists seq bigserial`)
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
	_, _ = s.db.Exec(ctx, `alter table attachments add column if not exists cloudinary_url text`)
	_, _ = s.db.Exec(ctx, `alter table attachments add column if not exists cloudinary_public_id text`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists caller_id text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists recipient_id text not null default ''`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists call_type text not null default 'audio'`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists status text not null default 'ringing'`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists started_at timestamptz not null default now()`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists answered_at timestamptz`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists ended_at timestamptz`)
	_, _ = s.db.Exec(ctx, `alter table call_history add column if not exists duration_seconds integer not null default 0`)
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
	_, _ = s.db.Exec(ctx, `drop index if exists idx_messages_conversation_created`)
	_, _ = s.db.Exec(ctx, `create index if not exists idx_messages_conversation_created on messages (conversation_id, created_at, seq)`)
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

func (s *Store) MessageByID(id string) (Message, error) {
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

// AICountToday returns the number of AI requests the user has already made
// today (UTC). It is used by the AI endpoint to enforce the daily limit.
func (s *Store) AICountToday(userID string) (int, error) {
	userID = strings.TrimSpace(userID)
	today := time.Now().UTC().Format("2006-01-02")
	if s.db != nil {
		var count int
		err := s.db.QueryRow(context.Background(), `
			select coalesce(request_count, 0)
			from ai_usage
			where user_id = $1 and usage_date = $2
		`, userID, today).Scan(&count)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, nil
			}
			return 0, err
		}
		return count, nil
	}
	if s.my != nil {
		var count int
		err := s.my.QueryRowContext(context.Background(), `
			select coalesce(request_count, 0)
			from ai_usage
			where user_id = ? and usage_date = ?
		`, userID, today).Scan(&count)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return 0, nil
			}
			return 0, err
		}
		return count, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.AIUsage == nil {
		return 0, nil
	}
	return s.data.AIUsage[userID][today], nil
}

// ReserveAIUsage atomically increments the user's daily AI request count and
// returns true only if the new count does not exceed the daily limit. This is
// the single gate that protects the Gemini quota: no request reaches Gemini
// unless ReserveAIUsage returned true.
func (s *Store) ReserveAIUsage(userID string, dailyLimit int) (bool, error) {
	userID = strings.TrimSpace(userID)
	if dailyLimit <= 0 {
		return false, nil
	}
	today := time.Now().UTC().Format("2006-01-02")
	if s.db != nil {
		var count int
		err := s.db.QueryRow(context.Background(), `
			insert into ai_usage (user_id, usage_date, request_count)
			values ($1, $2, 1)
			on conflict (user_id, usage_date) do update set
				request_count = case when ai_usage.request_count < $3 then ai_usage.request_count + 1 else ai_usage.request_count end
			returning request_count
		`, userID, today, dailyLimit).Scan(&count)
		if err != nil {
			return false, err
		}
		return count <= dailyLimit, nil
	}
	if s.my != nil {
		// MySQL does not support RETURNING; use a conditional update then read.
		_, _ = s.my.ExecContext(context.Background(), `
			insert into ai_usage (user_id, usage_date, request_count)
			values (?, ?, 1)
			on duplicate key update
				request_count = case when request_count < ? then request_count + 1 else request_count end
		`, userID, today, dailyLimit)
		var count int
		readErr := s.my.QueryRowContext(context.Background(), `
			select request_count from ai_usage where user_id = ? and usage_date = ?
		`, userID, today).Scan(&count)
		if readErr != nil {
			return false, readErr
		}
		return count <= dailyLimit, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.AIUsage == nil {
		s.data.AIUsage = make(map[string]map[string]int)
	}
	if s.data.AIUsage[userID] == nil {
		s.data.AIUsage[userID] = make(map[string]int)
	}
	count := s.data.AIUsage[userID][today]
	if count >= dailyLimit {
		return false, nil
	}
	s.data.AIUsage[userID][today] = count + 1
	if err := s.saveLocked(); err != nil {
		return false, err
	}
	return true, nil
}

// DecrementAIUsage refunds one daily AI request. It is called only when a
// reserved request fails before Gemini was actually invoked, so the user is
// not charged for a request that never reached the API.
func (s *Store) DecrementAIUsage(userID string) {
	userID = strings.TrimSpace(userID)
	today := time.Now().UTC().Format("2006-01-02")
	if s.db != nil {
		_, _ = s.db.Exec(context.Background(), `
			update ai_usage set request_count = greatest(request_count - 1, 0)
			where user_id = $1 and usage_date = $2
		`, userID, today)
		return
	}
	if s.my != nil {
		_, _ = s.my.ExecContext(context.Background(), `
			update ai_usage set request_count = greatest(request_count - 1, 0)
			where user_id = ? and usage_date = ?
		`, userID, today)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.AIUsage == nil || s.data.AIUsage[userID] == nil {
		return
	}
	if s.data.AIUsage[userID][today] > 0 {
		s.data.AIUsage[userID][today]--
		_ = s.saveLocked()
	}
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

func (s *Store) CreateCallHistory(id, callerID, recipientID, callType string) error {
	id = strings.TrimSpace(id)
	callerID = strings.TrimSpace(callerID)
	recipientID = strings.TrimSpace(recipientID)
	if id == "" || callerID == "" || recipientID == "" || callerID == recipientID {
		return errors.New("invalid call history")
	}
	if callType != "video" {
		callType = "audio"
	}

	if s.db != nil {
		_, err := s.db.Exec(context.Background(), `
			INSERT INTO call_history (id, caller_id, recipient_id, call_type, status, started_at)
			VALUES ($1, $2, $3, $4, 'ringing', NOW())
			ON CONFLICT (id) DO NOTHING
		`, id, callerID, recipientID, callType)
		return err
	}
	if s.my != nil {
		_, err := s.my.ExecContext(context.Background(), `
			INSERT INTO call_history (id, caller_id, recipient_id, call_type, status, started_at)
			VALUES (?, ?, ?, ?, 'ringing', UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE id = id
		`, id, callerID, recipientID, callType)
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, call := range s.data.CallHistory {
		if call.ID == id {
			return nil
		}
	}

	s.data.CallHistory = append(s.data.CallHistory, CallHistory{
		ID:          id,
		CallerID:    callerID,
		RecipientID: recipientID,
		CallType:    callType,
		Status:      "ringing",
		StartedAt:   time.Now().UTC(),
	})
	return s.saveLocked()
}

func (s *Store) UpdateCallHistoryStatus(id, status string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("call history id is required")
	}
	switch status {
	case "answered", "ended", "rejected", "missed":
	default:
		return errors.New("invalid call history status")
	}

	if s.db != nil {
		if status == "answered" {
			_, err := s.db.Exec(context.Background(), `
				UPDATE call_history
				SET status = $2, answered_at = COALESCE(answered_at, NOW())
				WHERE id = $1 AND status = 'ringing'
			`, id, status)
			return err
		} else if status == "ended" || status == "rejected" || status == "missed" {
			_, err := s.db.Exec(context.Background(), `
				UPDATE call_history 
				SET status = $2, 
				    ended_at = COALESCE(ended_at, NOW()),
				    duration_seconds = CASE WHEN answered_at IS NOT NULL AND $2 = 'ended' THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - answered_at))::INTEGER, 0) ELSE duration_seconds END
				WHERE id = $1 AND status <> $2
			`, id, status)
			return err
		}
	}
	if s.my != nil {
		if status == "answered" {
			_, err := s.my.ExecContext(context.Background(), `
				UPDATE call_history
				SET status = ?, answered_at = COALESCE(answered_at, UTC_TIMESTAMP())
				WHERE id = ? AND status = 'ringing'
			`, status, id)
			return err
		} else if status == "ended" || status == "rejected" || status == "missed" {
			_, err := s.my.ExecContext(context.Background(), `
				UPDATE call_history 
				SET status = ?, 
				    ended_at = COALESCE(ended_at, UTC_TIMESTAMP()),
				    duration_seconds = CASE WHEN answered_at IS NOT NULL AND ? = 'ended' THEN GREATEST(TIMESTAMPDIFF(SECOND, answered_at, COALESCE(ended_at, UTC_TIMESTAMP())), 0) ELSE duration_seconds END
				WHERE id = ? AND status <> ?
			`, status, status, id, status)
			return err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.CallHistory {
		if s.data.CallHistory[i].ID == id {
			s.data.CallHistory[i].Status = status
			now := time.Now().UTC()
			if status == "answered" {
				s.data.CallHistory[i].AnsweredAt = &now
			} else if status == "ended" || status == "rejected" || status == "missed" {
				s.data.CallHistory[i].EndedAt = &now
				if status == "ended" && s.data.CallHistory[i].AnsweredAt != nil {
					s.data.CallHistory[i].DurationSeconds = int(now.Sub(*s.data.CallHistory[i].AnsweredAt).Seconds())
				}
			}
			return s.saveLocked()
		}
	}
	return errors.New("call history not found")
}

func (s *Store) GetCallHistory(userID string, limit int) ([]CallHistory, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	if s.db != nil {
		rows, err := s.db.Query(context.Background(), `
			SELECT id, caller_id, recipient_id, call_type, status, started_at, answered_at, ended_at, duration_seconds 
			FROM call_history 
			WHERE caller_id = $1 OR recipient_id = $1 
			ORDER BY started_at DESC LIMIT $2
		`, userID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var histories []CallHistory
		for rows.Next() {
			var h CallHistory
			if err := rows.Scan(&h.ID, &h.CallerID, &h.RecipientID, &h.CallType, &h.Status, &h.StartedAt, &h.AnsweredAt, &h.EndedAt, &h.DurationSeconds); err != nil {
				return nil, err
			}
			histories = append(histories, h)
		}
		return histories, nil
	}

	if s.my != nil {
		rows, err := s.my.QueryContext(context.Background(), `
			SELECT id, caller_id, recipient_id, call_type, status, started_at, answered_at, ended_at, duration_seconds 
			FROM call_history 
			WHERE caller_id = ? OR recipient_id = ? 
			ORDER BY started_at DESC LIMIT ?
		`, userID, userID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var histories []CallHistory
		for rows.Next() {
			var h CallHistory
			if err := rows.Scan(&h.ID, &h.CallerID, &h.RecipientID, &h.CallType, &h.Status, &h.StartedAt, &h.AnsweredAt, &h.EndedAt, &h.DurationSeconds); err != nil {
				return nil, err
			}
			histories = append(histories, h)
		}
		return histories, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var histories []CallHistory
	for i := len(s.data.CallHistory) - 1; i >= 0; i-- {
		h := s.data.CallHistory[i]
		if h.CallerID == userID || h.RecipientID == userID {
			histories = append(histories, h)
			if len(histories) >= limit {
				break
			}
		}
	}
	if histories == nil {
		histories = []CallHistory{}
	}
	return histories, nil
}

func (s *Store) GetCallHistoryByID(id string) (CallHistory, error) {
	if s.db != nil {
		var h CallHistory
		err := s.db.QueryRow(context.Background(), `
			SELECT id, caller_id, recipient_id, call_type, status, started_at, answered_at, ended_at, duration_seconds 
			FROM call_history 
			WHERE id = $1
		`, id).Scan(&h.ID, &h.CallerID, &h.RecipientID, &h.CallType, &h.Status, &h.StartedAt, &h.AnsweredAt, &h.EndedAt, &h.DurationSeconds)
		return h, err
	}
	if s.my != nil {
		var h CallHistory
		err := s.my.QueryRowContext(context.Background(), `
			SELECT id, caller_id, recipient_id, call_type, status, started_at, answered_at, ended_at, duration_seconds 
			FROM call_history 
			WHERE id = ?
		`, id).Scan(&h.ID, &h.CallerID, &h.RecipientID, &h.CallType, &h.Status, &h.StartedAt, &h.AnsweredAt, &h.EndedAt, &h.DurationSeconds)
		return h, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, h := range s.data.CallHistory {
		if h.ID == id {
			return h, nil
		}
	}
	return CallHistory{}, errors.New("call history not found")
}

func (s *Store) CreateStatus(userID, statusType, textContent, mediaURL, caption, background string) (Status, error) {
	now := time.Now().UTC()
	status := Status{
		ID: randomID(), UserID: userID, Type: statusType, Text: textContent,
		MediaURL: mediaURL, Caption: caption, Background: background,
		CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour),
	}
	if s.db != nil {
		_, err := s.db.Exec(context.Background(), `
			INSERT INTO statuses (id, user_id, type, text_content, media_url, caption, background, created_at, expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		`, status.ID, status.UserID, status.Type, status.Text, status.MediaURL, status.Caption, status.Background, status.CreatedAt, status.ExpiresAt)
		return status, err
	}
	if s.my != nil {
		_, err := s.my.ExecContext(context.Background(), `
			INSERT INTO statuses (id, user_id, type, text_content, media_url, caption, background, created_at, expires_at)
			VALUES (?,?,?,?,?,?,?,?,?)
		`, status.ID, status.UserID, status.Type, status.Text, status.MediaURL, status.Caption, status.Background, status.CreatedAt, status.ExpiresAt)
		return status, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.userByIDLocked(userID); err != nil {
		return Status{}, err
	}
	s.data.Statuses = append(s.data.Statuses, status)
	return status, s.saveLocked()
}

func (s *Store) userByIDLocked(id string) (User, error) {
	for _, user := range s.data.Users {
		if user.ID == id {
			return user, nil
		}
	}
	return User{}, errors.New("user not found")
}

func scanStatusRows(rows messageRows) ([]StatusWithUser, error) {
	var statuses []StatusWithUser
	for rows.Next() {
		var item StatusWithUser
		if err := rows.Scan(&item.ID, &item.UserID, &item.Type, &item.Text, &item.MediaURL, &item.Caption, &item.Background, &item.CreatedAt, &item.ExpiresAt, &item.User.ID, &item.User.FirstName, &item.User.LastName, &item.User.Email, &item.User.AvatarURL, &item.IsViewed); err != nil {
			return nil, err
		}
		statuses = append(statuses, item)
	}
	if statuses == nil {
		statuses = []StatusWithUser{}
	}
	return statuses, rows.Err()
}

func (s *Store) GetActiveStatuses(viewerID, ownerID string, limit int) ([]StatusWithUser, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	if s.db != nil {
		query := `
			SELECT s.id, s.user_id, s.type, s.text_content, s.media_url, s.caption, s.background, s.created_at, s.expires_at,
				u.id, u.first_name, u.last_name, u.email, coalesce(u.avatar_url, ''),
			       EXISTS (SELECT 1 FROM status_views sv WHERE sv.status_id = s.id AND sv.viewer_id = $1)
			FROM statuses s JOIN app_users u ON u.id = s.user_id
			WHERE s.expires_at > now()`
		args := []any{viewerID}
		if ownerID != "" {
			query += " AND s.user_id = $2"
			args = append(args, ownerID)
		}
		query += " ORDER BY s.created_at DESC LIMIT $" + fmt.Sprint(len(args)+1)
		args = append(args, limit)
		rows, err := s.db.Query(context.Background(), query, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanStatusRows(rows)
	}
	if s.my != nil {
		query := `
			SELECT s.id, s.user_id, s.type, s.text_content, s.media_url, s.caption, s.background, s.created_at, s.expires_at,
				u.id, u.first_name, u.last_name, u.email, coalesce(u.avatar_url, ''),
			       EXISTS (SELECT 1 FROM status_views sv WHERE sv.status_id = s.id AND sv.viewer_id = ?)
			FROM statuses s JOIN app_users u ON u.id = s.user_id
			WHERE s.expires_at > UTC_TIMESTAMP()`
		args := []any{viewerID}
		if ownerID != "" {
			query += " AND s.user_id = ?"
			args = append(args, ownerID)
		}
		query += " ORDER BY s.created_at DESC LIMIT ?"
		args = append(args, limit)
		rows, err := s.my.QueryContext(context.Background(), query, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanStatusRows(rows)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	var result []StatusWithUser
	for i := len(s.data.Statuses) - 1; i >= 0 && len(result) < limit; i-- {
		status := s.data.Statuses[i]
		if !status.ExpiresAt.After(now) || (ownerID != "" && status.UserID != ownerID) {
			continue
		}
		user, err := s.userByIDLocked(status.UserID)
		if err != nil {
			continue
		}
		viewed := false
		for _, view := range s.data.StatusViews {
			if view.StatusID == status.ID && view.ViewerID == viewerID {
				viewed = true
				break
			}
		}
		result = append(result, StatusWithUser{Status: status, User: user, IsViewed: viewed})
	}
	if result == nil {
		result = []StatusWithUser{}
	}
	return result, nil
}

func (s *Store) MarkStatusViewed(statusID, viewerID string) error {
	if s.db != nil {
		_, err := s.db.Exec(context.Background(), `INSERT INTO status_views (status_id, viewer_id) VALUES ($1,$2) ON CONFLICT (status_id, viewer_id) DO NOTHING`, statusID, viewerID)
		return err
	}
	if s.my != nil {
		_, err := s.my.ExecContext(context.Background(), `INSERT IGNORE INTO status_views (status_id, viewer_id) VALUES (?,?)`, statusID, viewerID)
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, status := range s.data.Statuses {
		if status.ID == statusID && status.ExpiresAt.After(time.Now().UTC()) {
			for _, view := range s.data.StatusViews {
				if view.StatusID == statusID && view.ViewerID == viewerID {
					return nil
				}
			}
			s.data.StatusViews = append(s.data.StatusViews, StatusView{StatusID: statusID, ViewerID: viewerID, ViewedAt: time.Now().UTC()})
			return s.saveLocked()
		}
	}
	return errors.New("status not found")
}

func (s *Store) GetStatusViewers(statusID, ownerID string) ([]StatusViewer, error) {
	if s.db != nil {
		rows, err := s.db.Query(context.Background(), `
			SELECT u.id, u.email, u.first_name, u.last_name, coalesce(u.avatar_url, ''), sv.viewed_at
			FROM status_views sv JOIN statuses s ON s.id = sv.status_id JOIN app_users u ON u.id = sv.viewer_id
			WHERE sv.status_id = $1 AND s.user_id = $2 ORDER BY sv.viewed_at DESC
		`, statusID, ownerID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanStatusViewers(rows)
	}
	if s.my != nil {
		rows, err := s.my.QueryContext(context.Background(), `
			SELECT u.id, u.email, u.first_name, u.last_name, coalesce(u.avatar_url, ''), sv.viewed_at
			FROM status_views sv JOIN statuses s ON s.id = sv.status_id JOIN app_users u ON u.id = sv.viewer_id
			WHERE sv.status_id = ? AND s.user_id = ? ORDER BY sv.viewed_at DESC
		`, statusID, ownerID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanStatusViewers(rows)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var result []StatusViewer
	for _, status := range s.data.Statuses {
		if status.ID != statusID || status.UserID != ownerID {
			continue
		}
		for _, view := range s.data.StatusViews {
			if view.StatusID == statusID {
				if user, err := s.userByIDLocked(view.ViewerID); err == nil {
					result = append(result, StatusViewer{User: user, ViewedAt: view.ViewedAt})
				}
			}
		}
		break
	}
	if result == nil {
		result = []StatusViewer{}
	}
	return result, nil
}

func scanStatusViewers(rows messageRows) ([]StatusViewer, error) {
	var result []StatusViewer
	for rows.Next() {
		var viewer StatusViewer
		if err := rows.Scan(&viewer.User.ID, &viewer.User.Email, &viewer.User.FirstName, &viewer.User.LastName, &viewer.User.AvatarURL, &viewer.ViewedAt); err != nil {
			return nil, err
		}
		result = append(result, viewer)
	}
	if result == nil {
		result = []StatusViewer{}
	}
	return result, rows.Err()
}

func (s *Store) DeleteStatus(statusID, ownerID string) error {
	if s.db != nil {
		result, err := s.db.Exec(context.Background(), `DELETE FROM statuses WHERE id = $1 AND user_id = $2`, statusID, ownerID)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return errors.New("status not found")
		}
		return nil
	}
	if s.my != nil {
		result, err := s.my.ExecContext(context.Background(), `DELETE FROM statuses WHERE id = ? AND user_id = ?`, statusID, ownerID)
		if err != nil {
			return err
		}
		count, _ := result.RowsAffected()
		if count == 0 {
			return errors.New("status not found")
		}
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, status := range s.data.Statuses {
		if status.ID == statusID && status.UserID == ownerID {
			s.data.Statuses = append(s.data.Statuses[:i], s.data.Statuses[i+1:]...)
			filtered := s.data.StatusViews[:0]
			for _, view := range s.data.StatusViews {
				if view.StatusID != statusID {
					filtered = append(filtered, view)
				}
			}
			s.data.StatusViews = filtered
			return s.saveLocked()
		}
	}
	return errors.New("status not found")
}

func uniqueIDs(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}
	return result
}

func (s *Store) CreateGroup(name, avatarURL, ownerID string, memberIDs []string) (GroupDetails, error) {
	name = strings.TrimSpace(name)
	ownerID = strings.TrimSpace(ownerID)
	if name == "" {
		return GroupDetails{}, errors.New("group name is required")
	}
	if _, err := s.UserByID(ownerID); err != nil {
		return GroupDetails{}, errors.New("owner not found")
	}
	memberIDs = uniqueIDs(append([]string{ownerID}, memberIDs...))
	for _, id := range memberIDs {
		if _, err := s.UserByID(id); err != nil {
			return GroupDetails{}, fmt.Errorf("user %s not found", id)
		}
	}
	now := time.Now().UTC()
	group := Group{ID: randomID(), Name: name, AvatarURL: strings.TrimSpace(avatarURL), OwnerID: ownerID, CreatedAt: now, UpdatedAt: now}
	if s.db != nil {
		_, err := s.db.Exec(context.Background(), `insert into groups (id,name,avatar_url,owner_id,created_at,updated_at) values ($1,$2,$3,$4,$5,$6)`, group.ID, group.Name, group.AvatarURL, group.OwnerID, group.CreatedAt, group.UpdatedAt)
		if err != nil {
			return GroupDetails{}, err
		}
		for _, id := range memberIDs {
			role := "member"
			if id == ownerID {
				role = "owner"
			}
			if _, err := s.db.Exec(context.Background(), `insert into group_members (group_id,user_id,role,joined_at) values ($1,$2,$3,$4)`, group.ID, id, role, now); err != nil {
				return GroupDetails{}, err
			}
		}
	} else if s.my != nil {
		_, err := s.my.ExecContext(context.Background(), `insert into groups (id,name,avatar_url,owner_id,created_at,updated_at) values (?,?,?,?,?,?)`, group.ID, group.Name, group.AvatarURL, group.OwnerID, group.CreatedAt, group.UpdatedAt)
		if err != nil {
			return GroupDetails{}, err
		}
		for _, id := range memberIDs {
			role := "member"
			if id == ownerID {
				role = "owner"
			}
			if _, err := s.my.ExecContext(context.Background(), `insert into group_members (group_id,user_id,role,joined_at) values (?,?,?,?)`, group.ID, id, role, now); err != nil {
				return GroupDetails{}, err
			}
		}
	} else {
		s.mu.Lock()
		s.data.Groups = append(s.data.Groups, group)
		for _, id := range memberIDs {
			role := "member"
			if id == ownerID {
				role = "owner"
			}
			s.data.GroupMembers = append(s.data.GroupMembers, GroupMember{GroupID: group.ID, UserID: id, Role: role, JoinedAt: now})
		}
		if err := s.saveLocked(); err != nil {
			s.mu.Unlock()
			return GroupDetails{}, err
		}
		s.mu.Unlock()
	}
	return s.GetGroupDetails(group.ID, ownerID)
}

func (s *Store) groupRole(groupID, userID string) (string, error) {
	if s.db != nil {
		var role string
		err := s.db.QueryRow(context.Background(), `select role from group_members where group_id=$1 and user_id=$2`, groupID, userID).Scan(&role)
		return role, err
	}
	if s.my != nil {
		var role string
		err := s.my.QueryRowContext(context.Background(), `select role from group_members where group_id=? and user_id=?`, groupID, userID).Scan(&role)
		return role, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, member := range s.data.GroupMembers {
		if member.GroupID == groupID && member.UserID == userID {
			return member.Role, nil
		}
	}
	return "", errors.New("group membership not found")
}

func (s *Store) groupByID(groupID string) (Group, error) {
	if s.db != nil {
		var group Group
		err := s.db.QueryRow(context.Background(), `select id,name,avatar_url,owner_id,created_at,updated_at from groups where id=$1`, groupID).Scan(&group.ID, &group.Name, &group.AvatarURL, &group.OwnerID, &group.CreatedAt, &group.UpdatedAt)
		return group, err
	}
	if s.my != nil {
		var group Group
		err := s.my.QueryRowContext(context.Background(), `select id,name,avatar_url,owner_id,created_at,updated_at from groups where id=?`, groupID).Scan(&group.ID, &group.Name, &group.AvatarURL, &group.OwnerID, &group.CreatedAt, &group.UpdatedAt)
		return group, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, group := range s.data.Groups {
		if group.ID == groupID {
			return group, nil
		}
	}
	return Group{}, errors.New("group not found")
}

func (s *Store) groupLatestMessage(groupID string) (*GroupMessage, error) {
	if s.db != nil {
		var message GroupMessage
		err := s.db.QueryRow(context.Background(), `select id,group_id,sender_id,sender_email,body,attachment_name,attachment_type,attachment_kind,attachment_url,created_at from group_messages where group_id=$1 order by created_at desc,id desc limit 1`, groupID).Scan(&message.ID, &message.GroupID, &message.SenderID, &message.SenderEmail, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &message, nil
	}
	if s.my != nil {
		var message GroupMessage
		err := s.my.QueryRowContext(context.Background(), `select id,group_id,sender_id,sender_email,body,attachment_name,attachment_type,attachment_kind,attachment_url,created_at from group_messages where group_id=? order by created_at desc,id desc limit 1`, groupID).Scan(&message.ID, &message.GroupID, &message.SenderID, &message.SenderEmail, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &message, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest *GroupMessage
	for i := range s.data.GroupMessages {
		message := s.data.GroupMessages[i]
		if message.GroupID == groupID && (latest == nil || message.CreatedAt.After(latest.CreatedAt)) {
			copy := message
			latest = &copy
		}
	}
	return latest, nil
}

func (s *Store) ListGroups(userID string) ([]GroupSummary, error) {
	var summaries []GroupSummary
	if s.db != nil {
		rows, err := s.db.Query(context.Background(), `select g.id,g.name,g.avatar_url,g.owner_id,g.created_at,g.updated_at,gm.role,count(gm2.user_id) from groups g join group_members gm on gm.group_id=g.id left join group_members gm2 on gm2.group_id=g.id where gm.user_id=$1 group by g.id,g.name,g.avatar_url,g.owner_id,g.created_at,g.updated_at,gm.role order by g.updated_at desc`, userID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var summary GroupSummary
			if err := rows.Scan(&summary.ID, &summary.Name, &summary.AvatarURL, &summary.OwnerID, &summary.CreatedAt, &summary.UpdatedAt, &summary.Role, &summary.MemberCount); err != nil {
				return nil, err
			}
			summary.LatestMessage, err = s.groupLatestMessage(summary.ID)
			if err != nil {
				return nil, err
			}
			summaries = append(summaries, summary)
		}
		return summaries, rows.Err()
	}
	if s.my != nil {
		rows, err := s.my.QueryContext(context.Background(), `select g.id,g.name,g.avatar_url,g.owner_id,g.created_at,g.updated_at,gm.role,count(gm2.user_id) from groups g join group_members gm on gm.group_id=g.id left join group_members gm2 on gm2.group_id=g.id where gm.user_id=? group by g.id,g.name,g.avatar_url,g.owner_id,g.created_at,g.updated_at,gm.role order by g.updated_at desc`, userID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var summary GroupSummary
			if err := rows.Scan(&summary.ID, &summary.Name, &summary.AvatarURL, &summary.OwnerID, &summary.CreatedAt, &summary.UpdatedAt, &summary.Role, &summary.MemberCount); err != nil {
				return nil, err
			}
			summary.LatestMessage, err = s.groupLatestMessage(summary.ID)
			if err != nil {
				return nil, err
			}
			summaries = append(summaries, summary)
		}
		return summaries, rows.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, group := range s.data.Groups {
		for _, member := range s.data.GroupMembers {
			if member.GroupID == group.ID && member.UserID == userID {
				count := 0
				for _, candidate := range s.data.GroupMembers {
					if candidate.GroupID == group.ID {
						count++
					}
				}
				var latest *GroupMessage
				for i := range s.data.GroupMessages {
					message := s.data.GroupMessages[i]
					if message.GroupID == group.ID && (latest == nil || message.CreatedAt.After(latest.CreatedAt)) {
						copy := message
						latest = &copy
					}
				}
				summaries = append(summaries, GroupSummary{Group: group, Role: member.Role, MemberCount: count, LatestMessage: latest})
				break
			}
		}
	}
	return summaries, nil
}

func (s *Store) GetGroupDetails(groupID, userID string) (GroupDetails, error) {
	role, err := s.groupRole(groupID, userID)
	if err != nil {
		return GroupDetails{}, errors.New("group membership required")
	}
	group, err := s.groupByID(groupID)
	if err != nil {
		return GroupDetails{}, err
	}
	details := GroupDetails{GroupSummary: GroupSummary{Group: group, Role: role}, Members: []GroupMemberView{}}
	if s.db != nil {
		rows, err := s.db.Query(context.Background(), `select gm.group_id,gm.user_id,gm.role,gm.joined_at,u.id,u.email,u.first_name,u.last_name,u.password_hash,coalesce(u.avatar_url,''),u.blocked,u.created_at,u.updated_at from group_members gm join app_users u on u.id=gm.user_id where gm.group_id=$1 order by case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end,gm.joined_at`, groupID)
		if err != nil {
			return GroupDetails{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var member GroupMemberView
			if err := rows.Scan(&member.GroupID, &member.UserID, &member.Role, &member.JoinedAt, &member.User.ID, &member.User.Email, &member.User.FirstName, &member.User.LastName, &member.User.PasswordHash, &member.User.AvatarURL, &member.User.Blocked, &member.User.CreatedAt, &member.User.UpdatedAt); err != nil {
				return GroupDetails{}, err
			}
			details.Members = append(details.Members, member)
		}
		if err := rows.Err(); err != nil {
			return GroupDetails{}, err
		}
	} else if s.my != nil {
		rows, err := s.my.QueryContext(context.Background(), `select gm.group_id,gm.user_id,gm.role,gm.joined_at,u.id,u.email,u.first_name,u.last_name,u.password_hash,coalesce(u.avatar_url,''),u.blocked,u.created_at,u.updated_at from group_members gm join app_users u on u.id=gm.user_id where gm.group_id=? order by gm.role,gm.joined_at`, groupID)
		if err != nil {
			return GroupDetails{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var member GroupMemberView
			if err := rows.Scan(&member.GroupID, &member.UserID, &member.Role, &member.JoinedAt, &member.User.ID, &member.User.Email, &member.User.FirstName, &member.User.LastName, &member.User.PasswordHash, &member.User.AvatarURL, &member.User.Blocked, &member.User.CreatedAt, &member.User.UpdatedAt); err != nil {
				return GroupDetails{}, err
			}
			details.Members = append(details.Members, member)
		}
		if err := rows.Err(); err != nil {
			return GroupDetails{}, err
		}
	} else {
		s.mu.Lock()
		for _, member := range s.data.GroupMembers {
			if member.GroupID == groupID {
				for _, user := range s.data.Users {
					if user.ID == member.UserID {
						details.Members = append(details.Members, GroupMemberView{GroupMember: member, User: user})
						break
					}
				}
			}
		}
		s.mu.Unlock()
	}
	details.MemberCount = len(details.Members)
	details.LatestMessage, err = s.groupLatestMessage(groupID)
	return details, err
}

func (s *Store) UpdateGroup(groupID, userID, name, avatarURL string) error {
	role, err := s.groupRole(groupID, userID)
	if err != nil || (role != "owner" && role != "admin") {
		return errors.New("group admin permission required")
	}
	name = strings.TrimSpace(name)
	avatarURL = strings.TrimSpace(avatarURL)
	if name == "" {
		return errors.New("group name is required")
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `update groups set name=$1,avatar_url=$2,updated_at=now() where id=$3`, name, avatarURL, groupID)
		return err
	}
	if s.my != nil {
		_, err = s.my.ExecContext(context.Background(), `update groups set name=?,avatar_url=?,updated_at=utc_timestamp() where id=?`, name, avatarURL, groupID)
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Groups {
		if s.data.Groups[i].ID == groupID {
			s.data.Groups[i].Name = name
			s.data.Groups[i].AvatarURL = avatarURL
			s.data.Groups[i].UpdatedAt = time.Now().UTC()
			return s.saveLocked()
		}
	}
	return errors.New("group not found")
}

func (s *Store) AddGroupMembers(groupID, actorID string, memberIDs []string) error {
	role, err := s.groupRole(groupID, actorID)
	if err != nil || (role != "owner" && role != "admin") {
		return errors.New("group admin permission required")
	}
	memberIDs = uniqueIDs(memberIDs)
	for _, id := range memberIDs {
		if _, err := s.UserByID(id); err != nil {
			return fmt.Errorf("user %s not found", id)
		}
	}
	now := time.Now().UTC()
	if s.db != nil {
		for _, id := range memberIDs {
			_, err = s.db.Exec(context.Background(), `insert into group_members (group_id,user_id,role,joined_at) values ($1,$2,'member',$3) on conflict (group_id,user_id) do nothing`, groupID, id, now)
			if err != nil {
				return err
			}
		}
		return nil
	}
	if s.my != nil {
		for _, id := range memberIDs {
			_, err = s.my.ExecContext(context.Background(), `insert ignore into group_members (group_id,user_id,role,joined_at) values (?,?, 'member',?)`, groupID, id, now)
			if err != nil {
				return err
			}
		}
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range memberIDs {
		exists := false
		for _, member := range s.data.GroupMembers {
			if member.GroupID == groupID && member.UserID == id {
				exists = true
				break
			}
		}
		if !exists {
			s.data.GroupMembers = append(s.data.GroupMembers, GroupMember{GroupID: groupID, UserID: id, Role: "member", JoinedAt: now})
		}
	}
	return s.saveLocked()
}

func (s *Store) RemoveGroupMember(groupID, actorID, memberID string) error {
	actorRole, err := s.groupRole(groupID, actorID)
	if err != nil {
		return errors.New("group membership required")
	}
	targetRole, err := s.groupRole(groupID, memberID)
	if err != nil {
		return errors.New("member not found")
	}
	if memberID == actorID {
		if targetRole == "owner" {
			return errors.New("owner cannot leave the group")
		}
	} else if actorRole != "owner" && (actorRole != "admin" || targetRole != "member") {
		return errors.New("cannot remove this member")
	}
	if targetRole == "owner" {
		return errors.New("owner cannot be removed")
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `delete from group_members where group_id=$1 and user_id=$2`, groupID, memberID)
		return err
	}
	if s.my != nil {
		_, err = s.my.ExecContext(context.Background(), `delete from group_members where group_id=? and user_id=?`, groupID, memberID)
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, member := range s.data.GroupMembers {
		if member.GroupID == groupID && member.UserID == memberID {
			s.data.GroupMembers = append(s.data.GroupMembers[:i], s.data.GroupMembers[i+1:]...)
			return s.saveLocked()
		}
	}
	return errors.New("member not found")
}

func (s *Store) SetGroupAdmin(groupID, actorID, memberID string, promote bool) error {
	role, err := s.groupRole(groupID, actorID)
	if err != nil || role != "owner" {
		return errors.New("owner permission required")
	}
	targetRole, err := s.groupRole(groupID, memberID)
	if err != nil {
		return errors.New("member not found")
	}
	if targetRole == "owner" {
		return errors.New("owner role cannot change")
	}
	next := "member"
	if promote {
		next = "admin"
	}
	if targetRole != "admin" && targetRole != "member" {
		return errors.New("invalid member role")
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `update group_members set role=$1 where group_id=$2 and user_id=$3`, next, groupID, memberID)
		return err
	}
	if s.my != nil {
		_, err = s.my.ExecContext(context.Background(), `update group_members set role=? where group_id=? and user_id=?`, next, groupID, memberID)
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.GroupMembers {
		if s.data.GroupMembers[i].GroupID == groupID && s.data.GroupMembers[i].UserID == memberID {
			s.data.GroupMembers[i].Role = next
			return s.saveLocked()
		}
	}
	return errors.New("member not found")
}

func (s *Store) SaveGroupMessage(clientMessageID, groupID, senderID, body, attachmentName, attachmentType, attachmentKind, attachmentURL string) (GroupMessage, error) {
	if _, err := s.groupRole(groupID, senderID); err != nil {
		return GroupMessage{}, errors.New("group membership required")
	}
	sender, err := s.UserByID(senderID)
	if err != nil {
		return GroupMessage{}, err
	}
	message := GroupMessage{ID: strings.TrimSpace(clientMessageID), GroupID: groupID, SenderID: senderID, SenderEmail: sender.Email, Body: strings.TrimSpace(body), AttachmentName: strings.TrimSpace(attachmentName), AttachmentType: strings.TrimSpace(attachmentType), AttachmentKind: strings.TrimSpace(attachmentKind), AttachmentURL: strings.TrimSpace(attachmentURL), CreatedAt: time.Now().UTC()}
	if message.ID == "" {
		message.ID = randomID()
	}
	if message.Body == "" && message.AttachmentName == "" {
		return GroupMessage{}, errors.New("message is empty")
	}
	if s.db != nil {
		_, err = s.db.Exec(context.Background(), `insert into group_messages (id,group_id,sender_id,sender_email,body,attachment_name,attachment_type,attachment_kind,attachment_url,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, message.ID, message.GroupID, message.SenderID, message.SenderEmail, message.Body, message.AttachmentName, message.AttachmentType, message.AttachmentKind, message.AttachmentURL, message.CreatedAt)
		return message, err
	}
	if s.my != nil {
		_, err = s.my.ExecContext(context.Background(), `insert into group_messages (id,group_id,sender_id,sender_email,body,attachment_name,attachment_type,attachment_kind,attachment_url,created_at) values (?,?,?,?,?,?,?,?,?,?)`, message.ID, message.GroupID, message.SenderID, message.SenderEmail, message.Body, message.AttachmentName, message.AttachmentType, message.AttachmentKind, message.AttachmentURL, message.CreatedAt)
		return message, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.data.GroupMessages {
		if existing.ID == message.ID {
			return existing, nil
		}
	}
	s.data.GroupMessages = append(s.data.GroupMessages, message)
	for i := range s.data.Groups {
		if s.data.Groups[i].ID == groupID {
			s.data.Groups[i].UpdatedAt = message.CreatedAt
		}
	}
	return message, s.saveLocked()
}

func (s *Store) ListGroupMessages(groupID, userID string, limit int) ([]GroupMessage, error) {
	if _, err := s.groupRole(groupID, userID); err != nil {
		return nil, errors.New("group membership required")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if s.db != nil {
		rows, err := s.db.Query(context.Background(), `select id,group_id,sender_id,sender_email,body,attachment_name,attachment_type,attachment_kind,attachment_url,created_at from group_messages where group_id=$1 order by created_at desc,id desc limit $2`, groupID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var result []GroupMessage
		for rows.Next() {
			var message GroupMessage
			if err := rows.Scan(&message.ID, &message.GroupID, &message.SenderID, &message.SenderEmail, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt); err != nil {
				return nil, err
			}
			result = append(result, message)
		}
		reverseGroupMessages(result)
		return result, rows.Err()
	}
	if s.my != nil {
		rows, err := s.my.QueryContext(context.Background(), `select id,group_id,sender_id,sender_email,body,attachment_name,attachment_type,attachment_kind,attachment_url,created_at from group_messages where group_id=? order by created_at desc,id desc limit ?`, groupID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var result []GroupMessage
		for rows.Next() {
			var message GroupMessage
			if err := rows.Scan(&message.ID, &message.GroupID, &message.SenderID, &message.SenderEmail, &message.Body, &message.AttachmentName, &message.AttachmentType, &message.AttachmentKind, &message.AttachmentURL, &message.CreatedAt); err != nil {
				return nil, err
			}
			result = append(result, message)
		}
		reverseGroupMessages(result)
		return result, rows.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var result []GroupMessage
	for i := len(s.data.GroupMessages) - 1; i >= 0 && len(result) < limit; i-- {
		if s.data.GroupMessages[i].GroupID == groupID {
			result = append(result, s.data.GroupMessages[i])
		}
	}
	return result, nil
}

func reverseGroupMessages(messages []GroupMessage) {
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
}
