# Designing an OpenAgent character family

The collection shares soft material, rounded construction, close face framing
and the same two live pill eyes. A family earns its identity through a strong
silhouette, one recognizable characteristic and a small accent palette. The
eyes carry expression and respond to the same runtime state on every family.

## Color direction

Use a clear saturated body color, a restrained same-hue shadow and one or two
accent colors. Keep highlights out of the eye area so the white eye bars remain
legible in a 32-pixel circular avatar. The plush shader preserves original
pigment; do not compensate with another dark overlay in the family artwork.

| Family | Main direction | Signature detail |
| --- | --- | --- |
| Autos / SpaceX | Shared bright blue, cyan, orange, red, green, gold, violet and pink | Pill proportions / simple geometric silhouettes |
| Fold | Coral and warm paper highlights | Folded edges |
| Sprig | Leaf green and lime | Buds and leaves |
| Ripple | Blue and cyan | Flowing water forms |
| Halo | Violet and gold | Orbiting details |
| Purl | Teal and mint | Stitches and knit forms |
| Prism | Cobalt, lavender and aqua | Faceted edges |
| Coil | Blue and gold | Springs and bellows |
| Kiln | Coral and pink glaze | Ceramic handles and rims |
| Wisp | Red, orange and golden light | Flame curls |
| Relay | Warm cream, blue face panels and orange | Radio controls |
| Cairn | Clear slate blue with sand accents | Stacked stone forms |
| Tuft | Golden yellow and cream | Soft ears and tufts |
| Holidays | Recognizable colors per kind | Pumpkin, bat, acorn, tree, light and other seasonal silhouettes |

Paints live in `character-art-year-round.ts` and `character-art-seasonal.ts`.
Update both the artwork and its representative `color`; raised eye pods use
that metadata. The `characters.ts` palette supplies the eight deterministic
Autos/SpaceX seed slots. These decorative pigments are separate from DID
verification and the OAS Glyph palette.

## Future person and mascot families

Start with the one characteristic that makes the subject recognizable: a hair
shape, headwear, ears, mask silhouette or another distinctive detail. Add only
the few accent details that survive a small face crop. Related members share
construction and finish while their defining traits distinguish each member.

Treat a person's chosen complexion as a separate literal art color. Do not
derive it from a DID, infer it from identity metadata or recolor it through a
mascot palette. Clothing and accessories provide the collection's accent colors.
The current public API selects package-owned families and does not yet expose
person, complexion or brand-family fields; this is the design direction for
future additions.

Keep the existing live eyes, state transitions and reduced-motion behavior.
Glasses follow eye position at a fixed size; headphones attach outside the head.
Validate both face and raised-eye modes, with and without accessories, in the
full illustration and circular face crop. Inspect actual rendered output at
32 pixels as well as presentation size.
