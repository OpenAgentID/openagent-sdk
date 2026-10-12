/** Closed, package-owned vector art. Never accepts markup from a profile or caller. */
export interface CharacterArtNode {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children?: readonly CharacterArtNode[];
}

/** Art coordinates are a 320 by 400 full-character stage. */
export interface CharacterArt {
  /** Representative body tone when this kind differs from its family palette. */
  readonly color?: string;
  readonly body: CharacterArtNode;
  readonly face: { readonly x: number; readonly y: number; readonly scale: number };
  readonly crop: { readonly x: number; readonly y: number; readonly size: number };
}

export interface CharacterArtFamily {
  readonly label: string;
  /** Representative body color; art has its own curated multi-tone palette. */
  readonly color: string;
  readonly shapes: Readonly<Record<string, CharacterArt>>;
}
