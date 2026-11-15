package pokedex

import (
	"strings"
	"unicode"
)

// SpeciesForCard maps a card's printed set name and number to the species it
// battles as, using the card catalog. It mirrors findCatalogEntry in
// apps/web/lib/cards/mapping.ts: set names are matched against each set's
// aliases, and "58/102"-style numbers use the part before the slash.
func SpeciesForCard(setName, number string) (string, bool) {
	set, ok := db.setByAlias[normalize(setName)]
	if !ok {
		return "", false
	}
	key, ok := db.byCard[set+"#"+normalize(strings.SplitN(number, "/", 2)[0])]
	return key, ok
}

// SpeciesForName matches a display name such as "Mr. Mime" to its species key,
// ignoring case, spaces and punctuation. It is the fallback when an NFT names a
// card but lacks set and number attributes.
func SpeciesForName(name string) (string, bool) {
	key := db.byName[normalize(name)]
	return key, key != ""
}

// normalize lowercases and keeps only letters and digits, like norm() in mapping.ts.
func normalize(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
