package handlers

import (
	"net/http"

	"github.com/alghanim/agentboard/backend/config"
)

type BrandingHandler struct{}

// GetBranding handles GET /api/branding
func (h *BrandingHandler) GetBranding(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, config.GetBranding())
}
