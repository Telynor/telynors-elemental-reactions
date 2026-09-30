# Telynor's Elemental Reactions

Foundry VTT v14 / dnd5e module for configurable Genshin-style elemental reactions.

## Alpha features

- Seven default elements: Fire, Ice, Nature, Wind, Light, Dark, Physical.
- Element state on tokens with icon badge and glow.
- Actor infusion: an infused actor applies its active element to every Midi-QOL hit target.
- Second-element ownership: the actor applying the second element is the reaction source.
- Reaction directory with the default fusion pair names from Telynor's rules.
- Reaction Creation Wizard: damage, Actor summons, persistent visible zones, zone damage/element application, and text design.
- Reaction callouts over every affected token: pop, rise, fade, custom font, gradients; Vortex is Wind → partner element.
- Player element picker on character sheets, limited to GM-unlocked elements.
- Collective `Summoned Entities` combat turn for zone/summon processing.
- Priority-ready special variant override data model.
- Public API at `game.modules.get("telynors-elemental-reactions").api`.
- JSON export of element/reaction/variant configuration.

## Install

Paste the manifest URL from the latest release into Foundry's **Install Module** dialog.

## Important alpha note

Foundry sheets and Midi-QOL APIs evolve. This is the first testable alpha; bug reports should include Foundry, dnd5e, Midi-QOL and Dice So Nice versions plus browser-console errors.
