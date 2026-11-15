package livebattle

// Event is one BattleEvent. Shapes vary by "type", so it is an open map that
// marshals to the discriminated union the client reducer switches on
// (apps/web/lib/battle/types.ts). The constructors below are the single place
// each shape is defined, so a field name is never spelled out by hand twice.
type Event map[string]any

func evJoin(name string) Event { return Event{"type": "join", "name": name} }
func evStart() Event           { return Event{"type": "start"} }
func evResolving() Event       { return Event{"type": "resolving"} }
func evTurn(number int) Event  { return Event{"type": "turn", "turn": number} }

// evRequest asks for a decision. "choosing" applies to both players; a
// "switching" request names the one side that must replace a fainted creature,
// so the other client knows to wait.
func evRequest(phase, side string) Event {
	e := Event{"type": "request", "phase": phase}
	if side != "" {
		e["side"] = side
	}
	return e
}
func evSwitch(side string, teamIndex int) Event {
	return Event{"type": "switch", "side": side, "teamIndex": teamIndex}
}
func evMove(side string, moveIndex, ppLeft int) Event {
	return Event{"type": "move", "side": side, "moveIndex": moveIndex, "ppLeft": ppLeft}
}
func evMiss(side string) Event  { return Event{"type": "miss", "side": side} }
func evFaint(side string) Event { return Event{"type": "faint", "side": side} }
func evDamage(side string, hp int, effectiveness string, crit bool) Event {
	return Event{"type": "damage", "side": side, "hp": hp, "effectiveness": effectiveness, "crit": crit}
}
func evWin(winner string) Event { return Event{"type": "win", "winner": winner} }
func evChat(user, text string) Event {
	return Event{"type": "chat", "user": user, "text": text}
}
func evTimer(enabled bool, secondsLeft any) Event {
	return Event{"type": "timer", "enabled": enabled, "secondsLeft": secondsLeft}
}

// evInit carries the full opening state (minus log/animation/phase, which the
// client adds). It is shared by both players, so "you" is a placeholder: each
// client replaces it with its own side. The server is authoritative over every
// mutation recorded after this.
func evInit(id string, format Format, sides map[string]*SideState, users []string, timerEnabled bool) Event {
	var secondsLeft any
	if timerEnabled {
		secondsLeft = turnSeconds
	}
	return Event{
		"type": "init",
		"state": map[string]any{
			"id":            id,
			"format":        format,
			"turn":          1,
			"you":           "p1",
			"sides":         sides,
			"users":         users,
			"pendingChoice": nil,
			"winner":        nil,
			"timer":         map[string]any{"enabled": timerEnabled, "secondsLeft": secondsLeft, "secondsPerTurn": turnSeconds},
		},
	}
}
