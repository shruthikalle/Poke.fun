package pokedex

import (
	"regexp"
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

// SpeciesForCardName recognises the Pokémon on any card from its printed name,
// for cards outside the catalog. The same rules are implemented in
// apps/web/lib/cards/cardNames.ts; keep the two in step (the shared cases are
// in testdata/card_names.json).
//
//  1. Drop parentheticals, "with …" clauses and an owner ("Team Rocket's",
//     "Lillie's"): "Pikachu with Grey Felt Hat" → "Pikachu".
//  2. Note form markers: Alolan/Galarian/Hisuian/Paldean, a leading "M" or
//     "Mega" (and a trailing X or Y), "Primal", and VMAX or Gigantamax.
//  3. Find the longest run of up to four words that is a species' name, so
//     surrounding words ("Dark", "Radiant", "ex", "LV.X", "Single Strike")
//     don't matter.
//  4. Return the form for the markers if that species has it, else the
//     species' default form ("Deoxys" → deoxys-normal). Between twin forms the
//     card's other words decide ("Single Strike Urshifu VMAX").
func SpeciesForCardName(name string) (string, bool) {
	name = cleanCardName(name)
	words := strings.Fields(name)
	key, start, end := findSpecies(words)
	if key == "" {
		return "", false
	}
	if form := formMarker(words, start, end); form != "" {
		hints := append(append([]string{}, words[:start]...), words[end:]...)
		if formKey := findForm(key, form, hints); formKey != "" {
			return formKey, true
		}
	}
	return key, true
}

var (
	parenthetical = regexp.MustCompile(`\([^)]*\)|\[[^\]]*\]`)
	withClause    = regexp.MustCompile(`(?i)\s+with\s+.*$`)
	owner         = regexp.MustCompile(`^.*?['’]s\s+`)
)

func cleanCardName(name string) string {
	name = parenthetical.ReplaceAllString(name, " ")
	name = withClause.ReplaceAllString(name, "")
	return owner.ReplaceAllString(strings.TrimSpace(name), "")
}

// findSpecies returns the species for the longest (then leftmost) run of words
// that names one, and the run's bounds.
func findSpecies(words []string) (key string, start, end int) {
	for size := min(4, len(words)); size >= 1; size-- {
		for i := 0; i+size <= len(words); i++ {
			if k := db.byName[normalize(strings.Join(words[i:i+size], " "))]; k != "" {
				return k, i, i + size
			}
		}
	}
	return "", 0, 0
}

var regionalForms = map[string]string{"alolan": "alola", "galarian": "galar", "hisuian": "hisui", "paldean": "paldea"}

// formMarker reads the words around the species name for a form: "galar",
// "mega", "mega-x", "primal" or "gmax", or "" for the default form.
func formMarker(words []string, start, end int) string {
	for i, w := range words {
		lower := strings.ToLower(w)
		switch {
		case regionalForms[lower] != "":
			return regionalForms[lower]
		case lower == "primal":
			return "primal"
		case lower == "vmax" || lower == "gigantamax":
			return "gmax"
		case (w == "M" || lower == "mega") && i < start:
			if end < len(words) && (words[end] == "X" || words[end] == "Y") {
				return "mega-" + strings.ToLower(words[end])
			}
			return "mega"
		}
	}
	return ""
}

// findForm returns the species' form whose key contains the marker ("" if it
// has none). Among several, it prefers the one naming most of the card's other
// words ("single", "strike"), then an exact suffix ("charizard-mega-x" for
// mega-x), then Dex order.
func findForm(key, form string, hints []string) string {
	species := db.Species[db.byKey[key]].Species
	best, bestScore := "", -1
	for _, s := range db.Species {
		if s.Species != species || s.Default || !strings.Contains(s.Key+"-", "-"+form+"-") {
			continue
		}
		score := 0
		for _, h := range hints {
			if h = normalize(h); h != "" && strings.Contains(s.Key+"-", "-"+h+"-") {
				score += 2
			}
		}
		if strings.HasSuffix(s.Key, "-"+form) {
			score++
		}
		if score > bestScore {
			best, bestScore = s.Key, score
		}
	}
	return best
}

// accents folds the accented letters that appear in Pokémon names, so
// "Flabébé" and "Flabebe" match.
var accents = strings.NewReplacer("é", "e", "è", "e", "ê", "e", "ë", "e", "á", "a", "à", "a", "â", "a", "ä", "a",
	"í", "i", "ï", "i", "ó", "o", "ô", "o", "ö", "o", "ú", "u", "ü", "u", "ñ", "n", "ç", "c")

// normalize lowercases, folds accents, spells ♀ and ♂ as f and m (so the two
// Nidoran stay distinct) and keeps only ASCII letters and digits. Set aliases
// and card numbers go through it too, matching norm() in mapping.ts.
func normalize(s string) string {
	s = accents.Replace(strings.ToLower(s))
	s = strings.NewReplacer("♀", "f", "♂", "m").Replace(s)
	var b strings.Builder
	for _, r := range s {
		if r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
