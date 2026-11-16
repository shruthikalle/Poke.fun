package server

import "net/http"

// An absent asset is a public practice/rental selection. Providing an asset
// always opts into verification, even when the browser also labels it rental.
func (s *Server) verifyArenaAsset(w http.ResponseWriter, r *http.Request, species, assetID, wallet string) bool {
	if (assetID == "") != (wallet == "") {
		writeError(w, http.StatusBadRequest, "assetId and walletAddress are required together")
		return false
	}
	if assetID == "" {
		return true
	}
	if s.collectibles == nil {
		writeError(w, http.StatusServiceUnavailable, "NFT reader is not configured")
		return false
	}
	card, err := s.collectibles.Read(r.Context(), assetID, wallet)
	if err != nil {
		writeCollectibleError(w, err)
		return false
	}
	if card.ID != assetID || card.Owner != wallet || card.Attribute("Category") != "Pokemon" || nftSpecies(card) != species {
		writeError(w, http.StatusForbidden, "NFT does not match the selected fighter or owner")
		return false
	}
	return true
}

type arenaPlayerRequest struct {
	Name    string `json:"name"`
	CardID  string `json:"cardId"`
	AssetID string `json:"assetId"`
	Wallet  string `json:"walletAddress"`
	Rental  *bool  `json:"rental,omitempty"`
}
