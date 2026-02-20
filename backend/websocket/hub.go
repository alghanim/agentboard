package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Message represents a WebSocket message.
type Message struct {
	Type      string      `json:"type"`
	Payload   interface{} `json:"payload"`
	Timestamp time.Time   `json:"timestamp"`
}

// Client represents a connected WebSocket client.
type Client struct {
	ID            string
	Hub           *Hub
	Conn          *websocket.Conn
	Send          chan []byte
	Subscriptions map[string]bool
	mu            sync.RWMutex
}

// Hub maintains active clients and broadcasts messages.
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan *Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// NewHub creates a new WebSocket hub.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan *Message, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// RegisterClient registers a new client with the hub.
func (h *Hub) RegisterClient(client *Client) {
	h.register <- client
}

// Broadcast sends a typed message to all connected clients.
func (h *Hub) Broadcast(msgType string, payload interface{}) {
	message := &Message{
		Type:      msgType,
		Payload:   payload,
		Timestamp: time.Now(),
	}
	select {
	case h.broadcast <- message:
	default:
		log.Println("Broadcast channel full, dropping message")
	}
}

// Run starts the hub event loop.
// Keep-alives are handled by each client's own WritePump ticker —
// do NOT add a hub-level ping here (concurrent writes cause data races).
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("WS client registered: %s", client.ID)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
				log.Printf("WS client unregistered: %s", client.ID)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			data, err := json.Marshal(message)
			if err != nil {
				log.Printf("Error marshaling message: %v", err)
				continue
			}
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.Send <- data:
				default:
					go func(c *Client) { h.unregister <- c }(client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// ReadPump handles reading messages from the client.
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		var msg map[string]interface{}
		err := c.Conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WS error: %v", err)
			}
			break
		}
		if msgType, ok := msg["type"].(string); ok {
			switch msgType {
			case "subscribe":
				if id, ok := msg["id"].(string); ok {
					c.mu.Lock()
					c.Subscriptions[id] = true
					c.mu.Unlock()
				}
			case "unsubscribe":
				if id, ok := msg["id"].(string); ok {
					c.mu.Lock()
					delete(c.Subscriptions, id)
					c.mu.Unlock()
				}
			}
		}
	}
}

// WritePump handles writing messages to the client.
func (c *Client) WritePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
