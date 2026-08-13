import { describe, expect, test } from "bun:test";
import type { WorkspaceFile } from "./workspaceFiles";
import { reviewFrontendQuality } from "./validateFrontendQuality";

function file(path: string, content: string): WorkspaceFile {
  return { path, content, size: Buffer.byteLength(content) };
}

describe("reviewFrontendQuality", () => {
  test("rejects a barely modified Vite starter", () => {
    const review = reviewFrontendQuality([
      file("package.json", '{"dependencies":{"react":"latest"}}'),
      file(
        "src/App.jsx",
        "import viteLogo from '/vite.svg'; export default function App(){ return <><h1>Vite + React</h1><button>count is 0</button></> }",
      ),
      file("src/App.css", "body { display: grid; place-items: center; }"),
    ]);

    expect(review.passed).toBe(false);
    expect(review.issues.join(" ")).toContain("Vite/framework demo");
    expect(review.issues.join(" ")).toContain("responsive");
  });

  test("accepts an intentional responsive styled interface", () => {
    const styles = `
      :root { --color-bg: #07111f; --color-accent: #67e8f9; --space-4: 1rem; --radius: 1rem; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--color-bg); color: white; font-family: Inter, sans-serif; }
      .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
      .header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4); }
      .content { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; display: grid; gap: var(--space-4); grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .card { min-height: 12rem; padding: 1.5rem; border-radius: var(--radius); background: #102038; box-shadow: 0 1rem 3rem rgb(0 0 0 / .2); }
      button { border: 0; border-radius: .75rem; padding: .75rem 1rem; transition: transform .2s ease, background .2s ease; }
      button:hover { transform: translateY(-1px); }
      button:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; }
      button:active { transform: translateY(0); }
      button:disabled { opacity: .5; cursor: not-allowed; }
      @media (max-width: 48rem) { .content { grid-template-columns: 1fr; } .header { align-items: flex-start; } }
    `;
    const review = reviewFrontendQuality([
      file("package.json", '{"dependencies":{"react":"latest"}}'),
      file(
        "src/App.jsx",
        "export default function App(){ return <main className='shell'><header className='header'><h1>Daily Momentum</h1></header><section className='content'><article className='card'>Habit</article><button>Complete</button></section></main> }",
      ),
      file("src/App.css", styles),
    ]);

    expect(review).toEqual({ passed: true, issues: [] });
  });

  test("rejects a fixed-width horizontal rail at desktop widths", () => {
    const styles = `
      :root { --surface: white; }
      .shell { display: grid; grid-template-columns: 15rem 1fr; }
      .board { display: flex; overflow-x: auto; gap: 1rem; }
      .column { min-width: 20rem; flex-shrink: 0; background: var(--surface); }
      button { transition: transform .2s ease; }
      button:hover { transform: translateY(-1px); }
      button:focus-visible { outline: 2px solid blue; }
      @media (max-width: 48rem) { .shell { grid-template-columns: 1fr; } }
    `.repeat(3);
    const review = reviewFrontendQuality([
      file("package.json", '{"dependencies":{"react":"latest"}}'),
      file(
        "src/App.jsx",
        "export default function App(){ return <main className='shell'><section className='board'><article className='column'/><button>Task</button></section></main> }",
      ),
      file("src/App.css", styles),
    ]);

    expect(review.passed).toBe(false);
    expect(review.issues.join(" ")).toContain("desktop content");
  });
});
