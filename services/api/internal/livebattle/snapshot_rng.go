package livebattle

import "math/rand"

// Count source draws, rather than Float64 calls: Float64 can reject a value and
// draw again. Replaying Int63 preserves the standard library's exact sequence.
type snapshotSource struct {
	rand.Source
	draws uint64
}

func (s *snapshotSource) Int63() int64 {
	s.draws++
	return s.Source.Int63()
}

func (s *snapshotSource) Seed(seed int64) {
	s.Source.Seed(seed)
	s.draws = 0
}

type snapshotRNG struct {
	*rand.Rand
	source *snapshotSource
}

func newSnapshotRNG(seed int64) *snapshotRNG {
	source := &snapshotSource{Source: rand.NewSource(seed)}
	return &snapshotRNG{Rand: rand.New(source), source: source}
}
