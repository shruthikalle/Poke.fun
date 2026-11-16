package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
	"github.com/shruthikalle/Poke.fun/services/api/internal/resultstore"
)

func (s *Server) resultStore() (*resultstore.Store, error) {
	s.resultInit.Do(func() {
		if s.results == nil {
			s.results, s.resultErr = resultstore.Open("", "")
		}
	})
	return s.results, s.resultErr
}

func stateHash(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	// Normalize structs and restored JSON maps to the same sorted-key encoding.
	var normalized any
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return "", err
	}
	raw, err = json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

func winnerSeat(winner string) string {
	switch winner {
	case "player1":
		return "p1"
	case "player2":
		return "p2"
	default:
		return winner
	}
}

func (s *Server) sealArenaResult(game *arena.Game) error {
	if game.Winner == "" || game.Fighters[1] == nil {
		return nil
	}
	store, err := s.resultStore()
	if err != nil {
		return err
	}
	view := game.ViewFor(0)
	// Connection state and credentials are intentionally excluded from the digest.
	terms := s.terms[arenaTermsKey(game.ID)]
	result := resultstore.Result{ID: "arena:" + game.ID, MatchID: game.ID, Mode: "arena", Round: 1, EntryCents: terms.EntryCents,
		Winner: winnerSeat(game.Winner), Reason: game.ResultReason(), RulesVersion: "arena-v1", CatalogVersion: pokedex.Version()}
	for index, fighter := range view.Fighters {
		seat := fmt.Sprintf("p%d", index+1)
		result.Players[index] = resultstore.Participant{Seat: seat, Name: fighter.Name, Species: []string{fighter.Card.ID},
			Assets: terms.Seats[index].participantAssets()}
	}
	replay, err := json.Marshal(game.Replay())
	if err != nil {
		return err
	}
	result.StateHash, err = stateHash(game.Replay())
	if err != nil {
		return err
	}
	_, err = store.SealReplay(result, replay)
	return err
}

func (s *Server) sealLiveResult(game *livebattle.Battle) error {
	winner, over := game.Result()
	if !over {
		return nil
	}
	store, err := s.resultStore()
	if err != nil {
		return err
	}
	events, _ := game.EventsSince(0)
	start := 0
	for index, event := range events {
		if event["type"] == "init" {
			start = index
		}
	}
	end := len(events)
	for index := start; index < len(events); index++ {
		if events[index]["type"] == "win" {
			end = index + 1
			break
		}
	}
	var initial struct {
		Sides map[string]struct {
			Team []livebattle.Creature `json:"team"`
		} `json:"sides"`
	}
	raw, err := json.Marshal(events[start]["state"])
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, &initial); err != nil {
		return err
	}
	p1, p2 := game.Trainers()
	terms := s.terms[teamTermsKey(game.ID)]
	result := resultstore.Result{ID: fmt.Sprintf("team:%s:%d", game.ID, game.Round()), MatchID: game.ID,
		Mode: "team", Round: game.Round(), EntryCents: terms.EntryCents, Winner: winner, Reason: game.ResultReason(), RulesVersion: "team-v1", CatalogVersion: pokedex.Version()}
	for index, trainer := range []livebattle.Trainer{p1, p2} {
		seat := fmt.Sprintf("p%d", index+1)
		participant := resultstore.Participant{Seat: seat, Name: trainer.Name, Species: []string{},
			Assets: terms.Seats[index].participantAssets()}
		for _, creature := range initial.Sides[seat].Team {
			participant.Species = append(participant.Species, creature.SpriteID)
		}
		result.Players[index] = participant
	}
	replay, err := json.Marshal(events[start:end])
	if err != nil {
		return err
	}
	result.StateHash, err = stateHash(events[start:end])
	if err != nil {
		return err
	}
	_, err = store.SealReplay(result, replay)
	return err
}

func (s *Server) sealDuelResult(game *battle.Match) error {
	if game.Winner == "" || game.Players[1] == nil {
		return nil
	}
	store, err := s.resultStore()
	if err != nil {
		return err
	}
	result := resultstore.Result{ID: "duel:" + game.ID, MatchID: game.ID, Mode: "duel", Round: 1,
		Winner: winnerSeat(game.Winner), Reason: "knockout", RulesVersion: game.RulesVersion, CatalogVersion: game.CatalogVersion}
	for index, player := range game.Players {
		result.Players[index] = resultstore.Participant{Seat: fmt.Sprintf("p%d", index+1), Name: player.Name, Species: []string{player.Card.ID}}
	}
	replay, err := json.Marshal(game.ViewFor(0))
	if err != nil {
		return err
	}
	result.StateHash, err = stateHash(game.ViewFor(0))
	if err != nil {
		return err
	}
	if _, err := store.SealReplay(result, replay); err != nil {
		return err
	}
	return s.recordPlayerResult(result.ID, game.Players[0].Name, game.Players[1].Name, game.Winner)
}

func (s *Server) registerResultRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/referee", func(w http.ResponseWriter, _ *http.Request) {
		store, err := s.resultStore()
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "referee key is unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"publicKey": store.PublicKey(), "algorithm": "Ed25519", "schemaVersion": resultstore.SchemaVersion})
	})
	mux.HandleFunc("GET /api/arenas/{id}/result", s.arenaResult)
	mux.HandleFunc("GET /api/battles/{id}/result", s.teamResult)
	mux.HandleFunc("GET /api/matches/{id}/result", s.duelResult)
	mux.HandleFunc("GET /api/history", s.matchHistory)
	mux.HandleFunc("GET /api/replays/{id}", s.matchReplay)
}
