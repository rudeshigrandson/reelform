import type {
  ContainerLike,
  FillStyleLike,
  GraphicsLike,
  LayerPixi,
  PointLike,
  StrokeStyleLike,
  TextLike,
  TextStyleLike,
} from "./pixiTypes";

/**
 * Test double for the pixi.js surface in `pixiTypes.ts`. Graphics record their
 * draw calls; Text measures width as `chars × fontSize × 0.5`.
 */

export class FakePoint implements PointLike {
  x = 0;
  y = 0;
  constructor(v = 0) {
    this.x = v;
    this.y = v;
  }
  set(x: number, y: number = x): void {
    this.x = x;
    this.y = y;
  }
}

export class FakeContainer implements ContainerLike {
  label: string;
  visible = true;
  alpha = 1;
  rotation = 0;
  position = new FakePoint(0);
  scale = new FakePoint(1);
  pivot = new FakePoint(0);
  mask: unknown = null;
  children: FakeContainer[] = [];
  parent: FakeContainer | null = null;
  destroyed = false;

  constructor(options?: { label?: string }) {
    this.label = options?.label ?? "";
  }
  addChild(...children: ContainerLike[]): unknown {
    for (const c of children as FakeContainer[]) {
      c.parent?.removeChild(c);
      c.parent = this;
      this.children.push(c);
    }
    return children[0];
  }
  removeChild(...children: ContainerLike[]): unknown {
    for (const c of children as FakeContainer[]) {
      const i = this.children.indexOf(c);
      if (i >= 0) {
        this.children.splice(i, 1);
        c.parent = null;
      }
    }
    return children[0];
  }
  removeChildren(): unknown {
    for (const c of this.children) c.parent = null;
    const out = this.children;
    this.children = [];
    return out;
  }
  destroy(): void {
    this.destroyed = true;
    for (const c of this.children) c.destroy();
  }
}

export type GraphicsOp = [name: string, ...args: unknown[]];

export class FakeGraphics extends FakeContainer implements GraphicsLike {
  ops: GraphicsOp[] = [];
  clear(): this {
    this.ops = [];
    return this;
  }
  private op(name: string, ...args: unknown[]): this {
    this.ops.push([name, ...args]);
    return this;
  }
  rect(x: number, y: number, w: number, h: number): this {
    return this.op("rect", x, y, w, h);
  }
  roundRect(x: number, y: number, w: number, h: number, radius?: number): this {
    return this.op("roundRect", x, y, w, h, radius);
  }
  circle(x: number, y: number, radius: number): this {
    return this.op("circle", x, y, radius);
  }
  ellipse(x: number, y: number, rx: number, ry: number): this {
    return this.op("ellipse", x, y, rx, ry);
  }
  poly(points: number[], close?: boolean): this {
    return this.op("poly", points, close);
  }
  moveTo(x: number, y: number): this {
    return this.op("moveTo", x, y);
  }
  lineTo(x: number, y: number): this {
    return this.op("lineTo", x, y);
  }
  fill(style: FillStyleLike): this {
    return this.op("fill", style);
  }
  stroke(style: StrokeStyleLike): this {
    return this.op("stroke", style);
  }
  opNames(): string[] {
    return this.ops.map((o) => o[0]);
  }
}

export class FakeText extends FakeContainer implements TextLike {
  text: string;
  style: unknown;
  anchor = new FakePoint(0);
  constructor(options?: { text?: string; style?: TextStyleLike; label?: string }) {
    super(options?.label !== undefined ? { label: options.label } : undefined);
    this.text = options?.text ?? "";
    this.style = options?.style ?? {};
  }
  get width(): number {
    const size = (this.style as TextStyleLike).fontSize ?? 10;
    return [...this.text].length * size * 0.5;
  }
  set width(_v: number) {}
  get height(): number {
    return (this.style as TextStyleLike).fontSize ?? 10;
  }
  set height(_v: number) {}
}

export class FakeSprite extends FakeContainer {
  width = 0;
  height = 0;
}

export const fakePixi: LayerPixi = {
  Container: FakeContainer,
  Graphics: FakeGraphics,
  Text: FakeText,
};

/** Depth-first search by label. */
export function findByLabel(root: FakeContainer, label: string): FakeContainer[] {
  const out: FakeContainer[] = [];
  const walk = (n: FakeContainer): void => {
    if (n.label === label) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}
