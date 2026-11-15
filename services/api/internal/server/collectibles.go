package server

import (
	"errors"
	"net/http"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

func (s *Server) getCollectible(w http.ResponseWriter, r *http.Request) {
	if s.collectibles == nil {
		writeError(w, http.StatusServiceUnavailable, "NFT reader is not configured")
		return
	}
	owner := r.URL.Query().Get("owner")
	if owner == "" {
		writeError(w, http.StatusBadRequest, "owner is required")
		return
	}
	card, err := s.collectibles.Read(r.Context(), r.PathValue("id"), owner)
	if err != nil {
		writeCollectibleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, card)
}

func writeCollectibleError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, collectibles.ErrInvalidAddress):
		writeError(w, http.StatusBadRequest, "invalid Solana address")
	case errors.Is(err, collectibles.ErrNotFound):
		writeError(w, http.StatusNotFound, "NFT account not found")
	case errors.Is(err, collectibles.ErrWrongOwner):
		writeError(w, http.StatusForbidden, "NFT is not owned by this wallet")
	case errors.Is(err, collectibles.ErrWrongCollection), errors.Is(err, collectibles.ErrUnsupported):
		writeError(w, http.StatusForbidden, "NFT is not a supported collection asset")
	default:
		writeError(w, http.StatusBadGateway, "Could not verify NFT on Solana")
	}
}
