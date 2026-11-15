package battle

// Element is a card's combat type. The chart below mirrors the frontend's
// type table in apps/web/lib/battle/roster.ts so the authoritative server and
// the display layer agree on effectiveness.
type Element string

type typeRow struct {
	super    []Element
	resisted []Element
	immune   []Element
}

var typeChart = map[Element]typeRow{
	"Normal":   {resisted: []Element{"Rock", "Steel"}, immune: []Element{"Ghost"}},
	"Fire":     {super: []Element{"Grass", "Ice", "Bug", "Steel"}, resisted: []Element{"Fire", "Water", "Rock", "Dragon"}},
	"Water":    {super: []Element{"Fire", "Ground", "Rock"}, resisted: []Element{"Water", "Grass", "Dragon"}},
	"Grass":    {super: []Element{"Water", "Ground", "Rock"}, resisted: []Element{"Fire", "Grass", "Poison", "Flying", "Bug", "Dragon", "Steel"}},
	"Electric": {super: []Element{"Water", "Flying"}, resisted: []Element{"Electric", "Grass", "Dragon"}, immune: []Element{"Ground"}},
	"Ice":      {super: []Element{"Grass", "Ground", "Flying", "Dragon"}, resisted: []Element{"Fire", "Water", "Ice", "Steel"}},
	"Fighting": {super: []Element{"Normal", "Ice", "Rock", "Dark", "Steel"}, resisted: []Element{"Poison", "Flying", "Psychic", "Bug", "Fairy"}, immune: []Element{"Ghost"}},
	"Poison":   {super: []Element{"Grass", "Fairy"}, resisted: []Element{"Poison", "Ground", "Rock", "Ghost"}, immune: []Element{"Steel"}},
	"Ground":   {super: []Element{"Fire", "Electric", "Poison", "Rock", "Steel"}, resisted: []Element{"Grass", "Bug"}, immune: []Element{"Flying"}},
	"Flying":   {super: []Element{"Grass", "Fighting", "Bug"}, resisted: []Element{"Electric", "Rock", "Steel"}},
	"Psychic":  {super: []Element{"Fighting", "Poison"}, resisted: []Element{"Psychic", "Steel"}, immune: []Element{"Dark"}},
	"Bug":      {super: []Element{"Grass", "Psychic", "Dark"}, resisted: []Element{"Fire", "Fighting", "Poison", "Flying", "Ghost", "Steel", "Fairy"}},
	"Rock":     {super: []Element{"Fire", "Ice", "Flying", "Bug"}, resisted: []Element{"Fighting", "Ground", "Steel"}},
	"Ghost":    {super: []Element{"Psychic", "Ghost"}, resisted: []Element{"Dark"}, immune: []Element{"Normal"}},
	"Dragon":   {super: []Element{"Dragon"}, resisted: []Element{"Steel"}, immune: []Element{"Fairy"}},
	"Dark":     {super: []Element{"Psychic", "Ghost"}, resisted: []Element{"Fighting", "Dark", "Fairy"}},
	"Steel":    {super: []Element{"Ice", "Rock", "Fairy"}, resisted: []Element{"Fire", "Water", "Electric", "Steel"}},
	"Fairy":    {super: []Element{"Fighting", "Dragon", "Dark"}, resisted: []Element{"Fire", "Poison", "Steel"}},
}

func contains(list []Element, target Element) bool {
	for _, e := range list {
		if e == target {
			return true
		}
	}
	return false
}

// TypeMultiplier returns how effective an attack of element attack is against a
// defender of element defender: 2 (super), 1 (normal), 0.5 (resisted), 0 (immune).
// An unknown attacking element is treated as neutral.
func TypeMultiplier(attack, defender Element) float64 {
	row, ok := typeChart[attack]
	if !ok {
		return 1
	}
	switch {
	case contains(row.immune, defender):
		return 0
	case contains(row.super, defender):
		return 2
	case contains(row.resisted, defender):
		return 0.5
	default:
		return 1
	}
}

// EffectivenessLabel labels a type multiplier for the turn log, so both clients
// show the same "super effective" message the frontend renders. Shared with the
// livebattle engine so the two rulesets describe effectiveness identically.
func EffectivenessLabel(mult float64) string {
	switch {
	case mult == 0:
		return "immune"
	case mult > 1:
		return "super"
	case mult < 1:
		return "resisted"
	default:
		return "normal"
	}
}
