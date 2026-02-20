package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

var DB *sql.DB

// Config holds database connection parameters.
type Config struct {
	Host     string
	Port     int
	User     string
	Password string
	DBName   string
}

// Connect opens a PostgreSQL connection and runs auto-migration.
func Connect(cfg Config, schema string) error {
	connStr := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName,
	)

	var err error
	DB, err = sql.Open("postgres", connStr)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)
	DB.SetConnMaxLifetime(5 * time.Minute)

	// Retry connection (postgres may still be starting)
	for i := 0; i < 10; i++ {
		if err = DB.Ping(); err == nil {
			break
		}
		log.Printf("⏳ Waiting for database... (%d/10) %v", i+1, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("✅ Connected to PostgreSQL")

	if schema != "" {
		if _, err := DB.Exec(schema); err != nil {
			return fmt.Errorf("schema migration failed: %w", err)
		}
		log.Println("✅ Database schema applied")
	}

	return nil
}

// Close closes the database connection.
func Close() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}
