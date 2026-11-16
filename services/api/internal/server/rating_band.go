package server

import "time"

// Rating bands (PRD M-01). Compatible players (same format, power tier and
// entry) pair only within a rating band. The band starts at ±100 and widens by
// 50 for every 5 seconds the longer-waiting player has searched, so close
// ratings pair at once and nobody waits indefinitely: ±400 after 30 seconds,
// ±700 after a minute. Both queues also retry pairing on every poll, so a
// widening band can pair two players who are already waiting.
const (
	ratingBandBase  = 100
	ratingBandStep  = 50
	ratingBandEvery = 5 * time.Second
)

func ratingBand(waited time.Duration) int {
	if waited < 0 {
		waited = 0
	}
	return ratingBandBase + ratingBandStep*int(waited/ratingBandEvery)
}

// withinRatingBand applies the wider band of the two players.
func withinRatingBand(a, b int, waitedA, waitedB time.Duration) bool {
	return abs(a-b) <= ratingBand(max(waitedA, waitedB))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
