package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type Store struct {
	mu   sync.Mutex
	path string
	data dataFile
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

func New(path string) (*Store, error) {
	s := &Store{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) UpsertUser(email, firstName, lastName, password, avatarURL string) (User, error) {
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

func (s *Store) SearchUsers(query string) []User {
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
	s.mu.Lock()
	defer s.mu.Unlock()

	users := make([]User, len(s.data.Users))
	copy(users, s.data.Users)
	return users
}

func (s *Store) DeleteUser(id string) bool {
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
