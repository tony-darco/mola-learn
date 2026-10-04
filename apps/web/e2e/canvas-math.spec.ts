/**
 * Math elements: a placed math box can be reopened by double-clicking it and
 * its LaTeX changed, and the box always fits what it renders — a matrix
 * isn't clipped to the default 160×40, a long equation doesn't wrap.
 *
 *   E2E_PORT=3000 pnpm --filter @mola/web e2e --no-deps canvas-math
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { ALICE_STORAGE } from "./fixtures";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

const MATRIX = String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}\times\begin{bmatrix}5&6\\7&8\end{bmatrix}=\begin{bmatrix}19&22\\43&50\end{bmatrix}`;
const EDITED = String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}\times\begin{bmatrix}5&6\\7&8\end{bmatrix}=\begin{bmatrix}19&22\\43&51\end{bmatrix}`;
/** MathLive re-serializes what it's given, so compare without braces or spaces. */
const squash = (latex: string) => latex.replace(/[{}\s]/g, "");

type SavedMath = { id: string; type: string; width: number; height: number; props: { latex: string } };

async function createCanvas(page: Page): Promise<string> {
  await page.goto("/artifacts");
  await page.getByRole("button", { name: "+ New Canvas" }).click();
  const dialog = page.locator("form").filter({ hasText: "New Whiteboard" });
  await dialog.getByLabel("Name").fill("E2E Math");
  await dialog.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/canvas\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

async function enterMath(page: Page, latex: string) {
  const field = page.locator("math-field");
  await expect(field).toBeVisible();
  await field.evaluate((el, value) => { (el as HTMLElement & { value: string }).value = value; }, latex);
  await field.press("Escape");
  await expect(field).toHaveCount(0);
}

test.describe("math elements", () => {
  test.use({ storageState: ALICE_STORAGE });

  test("double-click reopens a placed math box for editing, and the box fits its content", async ({ page }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      canvasId = await createCanvas(page);
      const readMath = async (): Promise<SavedMath[]> => {
        const [row] = await sql<{ payload: { elements: SavedMath[] } }[]>`select payload from artifacts where id = ${canvasId!}`;
        return (row?.payload.elements ?? []).filter((e) => e.type === "math");
      };

      const svg = page.locator("svg.touch-none");
      const box = (await svg.boundingBox())!;
      const mathTool = page.getByTitle("Math", { exact: true });
      await expect(async () => {
        await mathTool.click();
        await expect(mathTool).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass();
      await page.mouse.click(box.x + 400, box.y + 200);
      await enterMath(page, MATRIX);

      // The rendered formula fits inside its box: nothing clipped, no wrapping.
      const shape = svg.locator("foreignObject[data-element-id]").filter({ has: page.locator(".katex") });
      await expect(shape).toHaveCount(1);
      await expect.poll(async () => shape.evaluate((fo) => {
        const content = fo.firstElementChild as HTMLElement;
        return content.scrollWidth <= Number(fo.getAttribute("width")) && content.scrollHeight <= Number(fo.getAttribute("height"));
      })).toBe(true);
      await expect.poll(async () => (await readMath())[0]?.height ?? 0, { timeout: 15_000 }).toBeGreaterThan(40);

      // Double-click reopens the editor on the saved LaTeX; changing it saves the new value.
      await shape.dblclick();
      const field = page.locator("math-field");
      await expect(field).toBeVisible();
      expect(squash(await field.evaluate((el) => (el as HTMLElement & { value: string }).value))).toBe(squash(MATRIX));
      await enterMath(page, EDITED);
      await expect.poll(async () => squash((await readMath())[0]?.props.latex ?? ""), { timeout: 15_000 }).toBe(squash(EDITED));
      expect(await readMath()).toHaveLength(1);
    } finally {
      if (canvasId) await sql`delete from artifacts where id = ${canvasId}`;
      await sql.end();
    }
  });
});
