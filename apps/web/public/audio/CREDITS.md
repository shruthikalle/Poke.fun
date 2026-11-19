# Audio credits

| Files | Source | Licence |
| --- | --- | --- |
| `sfx/*.mp3`, `music/*.mp3` | Original Poke.fun chiptune, rendered by `scripts/build-audio.mjs` (no samples) | Same as this repository |
| `cries/{dex}.mp3` | [PokeAPI/cries](https://github.com/PokeAPI/cries), converted to MP3 for Safari by `scripts/build-audio.mjs --cries` | Pokémon cries © Nintendo / Game Freak / The Pokémon Company, used in this non-commercial fan demo like the PokéAPI sprites |

Cries for species outside the card catalog stream from PokeAPI/cries as OGG in browsers that support it.
Run `npm run audio` to rebuild everything (needs `ffmpeg`).
