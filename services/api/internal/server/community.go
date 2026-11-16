package server

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
)

const presenceTTL = 35 * time.Second
const roomHistoryLimit = 200

type communityPresence struct {
	name  string
	seen  time.Time
	rooms map[string]time.Time
}

type roomMessage struct {
	ID   int64  `json:"id"`
	User string `json:"user"`
	Text string `json:"text"`
	At   int64  `json:"at"`
}

type communityState struct {
	presence map[string]*communityPresence
	messages map[string][]roomMessage
	sequence int64
}

func newCommunity() *communityState {
	return &communityState{presence: map[string]*communityPresence{}, messages: map[string][]roomMessage{}}
}

type communityRoom struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Users       int    `json:"users"`
	Description string `json:"description"`
	Section     string `json:"section"`
}

type communityTrainer struct {
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

type communityBattle struct {
	ID       string              `json:"id"`
	Kind     string              `json:"kind"`
	RoomID   string              `json:"roomId"`
	Format   string              `json:"format"`
	Turn     int                 `json:"turn"`
	Trainers [2]communityTrainer `json:"trainers"`
}

// These helpers run under s.mu. Counts reflect unexpired heartbeat sessions and
// arena sockets, deduplicated by public demo name; reading a feed adds no user.
func (s *Server) prunePresence(now time.Time) {
	if s.community == nil {
		s.community = newCommunity()
	}
	for token, p := range s.community.presence {
		if now.Sub(p.seen) > presenceTTL {
			delete(s.community.presence, token)
			continue
		}
		for room, seen := range p.rooms {
			if now.Sub(seen) > presenceTTL {
				delete(p.rooms, room)
			}
		}
	}
}

func (s *Server) communityRooms() []communityRoom {
	rooms := []communityRoom{
		{ID: "lobby", Name: "Lobby", Description: "Hang out between battles.", Section: "official"},
		{ID: "help", Name: "Help", Description: "Ask other trainers.", Section: "official"},
		{ID: "one-card", Name: "One-Card Arena", Description: "Discuss live arena battles.", Section: "community"},
		{ID: "collectors", Name: "Collectors", Description: "Talk cards with other trainers.", Section: "community"},
	}
	for _, b := range s.communityBattles() {
		rooms = append(rooms, communityRoom{ID: b.RoomID, Name: b.Trainers[0].Name + " vs " + b.Trainers[1].Name, Description: b.Format + " discussion (chat only).", Section: "community"})
	}
	for i := range rooms {
		names := map[string]bool{}
		for _, p := range s.community.presence {
			if _, ok := p.rooms[rooms[i].ID]; ok {
				names[strings.ToLower(p.name)] = true
			}
		}
		rooms[i].Users = len(names)
	}
	return rooms
}

func (s *Server) knownRoom(id string) bool {
	for _, room := range s.communityRooms() {
		if room.ID == id {
			return true
		}
	}
	// A finished battle's discussion stays accessible for the server lifetime.
	if strings.HasPrefix(id, "live-arena-") {
		return s.arenas[strings.TrimPrefix(id, "live-arena-")] != nil
	}
	if strings.HasPrefix(id, "live-team-") {
		return s.battles[strings.TrimPrefix(id, "live-team-")] != nil
	}
	return false
}

func (s *Server) communityBattles() []communityBattle {
	out := []communityBattle{}
	for _, g := range s.arenas {
		if g.Fighters[1] == nil || g.Winner != "" {
			continue
		}
		out = append(out, communityBattle{ID: g.ID, Kind: "arena", RoomID: "live-arena-" + g.ID, Format: "Live arena", Turn: g.Tick / (1000 / arena.TickMs), Trainers: [2]communityTrainer{{g.Fighters[0].Name, "maya"}, {g.Fighters[1].Name, "rook"}}})
	}
	for _, b := range s.battles {
		if !b.Started() || b.Over() || b.Mode() != livebattle.ModePvP {
			continue
		}
		p1, p2 := b.Trainers()
		item := communityBattle{ID: b.ID, Kind: "team", RoomID: "live-team-" + b.ID, Format: "Team battle", Trainers: [2]communityTrainer{{p1.Name, safeAvatar(p1.Avatar)}, {p2.Name, safeAvatar(p2.Avatar)}}}
		events, _ := b.EventsSince(0)
		for _, event := range events {
			if event["type"] == "turn" {
				item.Turn, _ = event["turn"].(int)
			}
			if event["type"] == "init" {
				if state, ok := event["state"].(map[string]any); ok {
					if format, ok := state["format"].(livebattle.Format); ok && format.Name != "" {
						item.Format = format.Name
					}
				}
			}
		}
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RoomID < out[j].RoomID })
	return out
}

func safeAvatar(avatar string) string {
	switch avatar {
	case "maya", "rook", "kai", "theo":
		return avatar
	default:
		return "maya"
	}
}

func (s *Server) getCommunity(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prunePresence(time.Now())
	names := map[string]bool{}
	for _, p := range s.community.presence {
		names[strings.ToLower(p.name)] = true
	}
	for id, peers := range s.peers {
		g := s.arenas[id]
		if g == nil {
			continue
		}
		for peer := range peers {
			if f := g.Fighters[peer.index]; f != nil {
				names[strings.ToLower(f.Name)] = true
			}
		}
	}
	live := s.communityBattles()
	writeJSON(w, http.StatusOK, map[string]any{"usersOnline": len(names), "activeBattles": len(live), "liveBattles": live, "rooms": s.communityRooms(), "namespace": "Public demo names; not verified identities."})
}
