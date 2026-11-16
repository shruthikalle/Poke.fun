package resultstore

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

const SchemaVersion = "1"

type Participant struct {
	Seat    string   `json:"seat"`
	Name    string   `json:"name"`
	Species []string `json:"species"`
	// Assets are the verified NFTs aligned with Species ("" = rental). Absent
	// when the whole seat used rentals.
	Assets []string `json:"assets,omitempty"`
}

// Result describes an adjudicated game, not a deposit or an on-chain payout.
type Result struct {
	SchemaVersion string         `json:"schemaVersion"`
	ID            string         `json:"id"`
	MatchID       string         `json:"matchId"`
	Mode          string         `json:"mode"`
	Round         int            `json:"round"`
	Players       [2]Participant `json:"players"`
	// EntryCents is the entry both seats agreed to at pairing. It is a term of
	// the match, not evidence of a deposit: see Funding and Settlement.
	EntryCents     int    `json:"entryCents,omitempty"`
	Winner         string `json:"winner"`
	Reason         string `json:"reason"`
	RulesVersion   string `json:"rulesVersion"`
	CatalogVersion string `json:"catalogVersion"`
	StateHash      string `json:"stateHash"`
	EndedAt        int64  `json:"endedAt"`
	Funding        string `json:"funding"`
	Settlement     string `json:"settlement"`
}

type Envelope struct {
	Result    Result `json:"result"`
	Payload   string `json:"payload"`
	Algorithm string `json:"algorithm"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	// Replay is the exact public combat record committed by Result.StateHash.
	Replay json.RawMessage `json:"replay,omitempty"`
}

func (r Result) validate() error {
	digest, err := hex.DecodeString(r.StateHash)
	if err != nil || len(digest) != 32 || r.SchemaVersion != SchemaVersion ||
		r.ID == "" || r.MatchID == "" || r.Mode == "" || r.Round < 1 || r.EndedAt <= 0 ||
		r.RulesVersion == "" || r.CatalogVersion == "" || r.Reason == "" ||
		r.Funding != "unfunded" || r.Settlement != "not_connected" || r.EntryCents < 0 {
		return errors.New("invalid authoritative result")
	}
	if r.Winner != "p1" && r.Winner != "p2" && r.Winner != "draw" {
		return errors.New("invalid winner")
	}
	for index, player := range r.Players {
		seat := "p1"
		if index == 1 {
			seat = "p2"
		}
		if player.Seat != seat || strings.TrimSpace(player.Name) == "" || len(player.Species) == 0 ||
			player.Assets != nil && len(player.Assets) != len(player.Species) {
			return errors.New("invalid result participant")
		}
	}
	return nil
}
