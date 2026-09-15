/**
 * Minimal structural view of the pixi.js 8 surface the scene layers use.
 * Drawers receive the pixi module as a parameter typed with `LayerPixi`, so
 * tests can pass a fake and never load pixi.js. `PixiModuleCompat` fails to
 * type-check if the real module ever stops satisfying this interface.
 */

export interface PointLike {
  x: number;
  y: number;
  set(x: number, y?: number): void;
}

export interface ContainerLike {
  label: string;
  visible: boolean;
  alpha: number;
  /** Radians. */
  rotation: number;
  position: PointLike;
  scale: PointLike;
  pivot: PointLike;
  /** Read type is `unknown` on real pixi; assign a Graphics or null. */
  mask: unknown;
  addChild(...children: ContainerLike[]): unknown;
  removeChild(...children: ContainerLike[]): unknown;
  removeChildren(): unknown;
  destroy(options?: boolean | { children?: boolean }): void;
}

export interface FillStyleLike {
  color: number;
  alpha?: number;
}

export interface StrokeStyleLike {
  color: number;
  width: number;
  alpha?: number;
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
}

export interface GraphicsLike extends ContainerLike {
  clear(): this;
  rect(x: number, y: number, w: number, h: number): this;
  roundRect(x: number, y: number, w: number, h: number, radius?: number): this;
  circle(x: number, y: number, radius: number): this;
  ellipse(x: number, y: number, radiusX: number, radiusY: number): this;
  poly(points: number[], close?: boolean): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  fill(style: FillStyleLike): this;
  stroke(style: StrokeStyleLike): this;
}

export type FontWeightLike = "400" | "500" | "600" | "700" | "800";

export interface TextStyleLike {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: FontWeightLike;
  fill?: number;
  stroke?: { color: number; width: number };
  align?: "left" | "center" | "right";
}

export interface TextLike extends ContainerLike {
  text: string;
  /** Read type differs on real pixi; assign a `TextStyleLike`. */
  style: unknown;
  anchor: PointLike;
  width: number;
  height: number;
}

/** A sprite the stage owns (e.g. the webcam video sprite). */
export interface SpriteLike extends ContainerLike {
  width: number;
  height: number;
}

export interface LayerPixi {
  Container: new (options?: { label?: string }) => ContainerLike;
  Graphics: new (options?: { label?: string }) => GraphicsLike;
  Text: new (options?: { text?: string; style?: TextStyleLike; label?: string }) => TextLike;
}

type Assert<T extends true> = T;
/** Compile-time check that the real pixi.js module satisfies `LayerPixi`. */
export type PixiModuleCompat = Assert<typeof import("pixi.js") extends LayerPixi ? true : false>;
