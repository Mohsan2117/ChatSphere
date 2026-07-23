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
			if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
				return User{}, errors.New("invalid email or password")
			}
			return user, nil
		}
	}
	return User{}, errors.New("invalid email or password")
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
