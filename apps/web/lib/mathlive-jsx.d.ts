/** Lets `<math-field>` (registered by the `mathlive` package) appear in JSX;
 * React 19 nests its JSX namespace inside the "react" module itself, so the
 * augmentation has to target that module directly rather than a bare
 * `declare global { namespace JSX }` (which no longer merges with it). */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "math-field": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
