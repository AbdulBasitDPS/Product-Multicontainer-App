package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Client struct {
	conn *websocket.Conn
	send chan []byte
}

type Hub struct {
	mu        sync.Mutex
	clients   map[*Client]struct{}
	broadcast chan []byte
}

func newHub() *Hub {
	return &Hub{clients: map[*Client]struct{}{}, broadcast: make(chan []byte, 256)}
}

func (h *Hub) add(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) remove(c *Client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
}

func (h *Hub) run() {
	for msg := range h.broadcast {
		h.mu.Lock()
		for c := range h.clients {
			select {
			case c.send <- msg:
			default: // slow client: drop it
				delete(h.clients, c)
				close(c.send)
			}
		}
		h.mu.Unlock()
	}
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (a *App) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	c := &Client{conn: conn, send: make(chan []byte, 64)}
	a.hub.add(c)

	go func() { // writer
		for msg := range c.send {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				break
			}
		}
		conn.Close()
	}()

	// reader: only used to detect disconnects
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	a.hub.remove(c)
	conn.Close()
}

// subscribeEvents relays worker events (Dragonfly pub/sub) to every WebSocket client.
func (a *App) subscribeEvents(ctx context.Context) {
	sub := a.rdb.Subscribe(ctx, "job_progress", "stock_alerts")
	defer sub.Close()
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			payload, err := json.Marshal(map[string]any{
				"channel": msg.Channel,
				"data":    json.RawMessage(msg.Payload),
			})
			if err != nil {
				continue
			}
			select {
			case a.hub.broadcast <- payload:
			default:
			}
		}
	}
}
