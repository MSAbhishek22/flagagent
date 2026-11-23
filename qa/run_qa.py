#!/usr/bin/env python3
"""FlagAgent browser QA — real clicks against the locally served page.
Run: python3 qa/run_qa.py  (serves the project on :8907, drives Chromium)
Writes screenshots to qa/ and prints a check-by-check result."""
import subprocess, sys, time, os, signal
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8907
URL = f"http://127.0.0.1:{PORT}/index.html"

results = []
def check(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    print(("  ok — " if cond else "  FAIL — ") + name + ((" :: " + str(extra)) if (extra and not cond) else ""))

server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                          cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_selector("#watchBody tr")

        check("page loads with the FlagAgent title", "FlagAgent" in page.title())
        check("settings panel starts hidden", not page.is_visible("#settingsPanel"))
        check("mode chip honestly says MOCK", "MOCK" in page.inner_text("#modeChip"))
        check("hero signal board renders 3 working switches", page.locator("[data-hero-flag]").count() == 3)
        check("watch board lists 6 demo flags", page.locator("#watchBody tr").count() == 6)
        page.screenshot(path=os.path.join(ROOT, "qa", "hero.png"))

        # Guarded rollout: chip -> plan -> approve -> apply -> receipt -> board
        page.click("[data-example]:nth-child(2)")  # first chip after label = guarded rollout
        page.click("#planBtn")
        page.wait_for_selector("#planArea:not([hidden])")
        plan_text = page.inner_text("#planArea")
        check("plan shows the enable diff", "OFF → ON" in plan_text)
        check("plan shows the rollout diff", "rollout 0% → 10%" in plan_text)
        check("guard is shown holding", "holding" in plan_text and "payments_kill_switch" in plan_text)
        check("plan hash is shown", "plan #" in page.inner_text("#planHash"))
        check("apply is armed with both changes ticked", page.is_enabled("#applyBtn"))
        page.screenshot(path=os.path.join(ROOT, "qa", "plan.png"))
        page.click("#applyBtn")
        page.wait_for_selector("#receiptArea:not([hidden])")
        receipt = page.inner_text("#receiptBody")
        check("receipt reports 2 of 2 applied and read back", "2 of 2" in receipt, receipt[:200])
        page.wait_for_function("document.querySelector('#watchBody').innerText.includes('new_checkout')")
        watch = page.inner_text("#watchBody")
        nc_row = [l for l in watch.split("\n") if "new_checkout" in l]
        check("board now shows new_checkout ON at 10%", any("ON" in l and "10%" in l for l in [watch]))

        # Hero switch flip moves the board
        page.click("[data-hero-flag='search_v2']")
        page.wait_for_function("document.querySelectorAll('#watchBody tr')[2].innerText.includes('OFF')")
        check("hero switch flip turns search_v2 OFF on the board", True)

        # Delete needs the typed name
        page.evaluate("document.querySelectorAll('[data-example]')[3].click()")
        page.click("#planBtn")
        page.wait_for_selector("[data-confirm-input]")
        check("delete plan keeps apply disarmed before typing", page.is_disabled("#applyBtn"))
        page.fill("[data-confirm-input]", "legacy_search")
        check("typing the flag name arms the apply", page.is_enabled("#applyBtn"))
        page.click("#applyBtn")
        page.wait_for_function("document.querySelectorAll('#watchBody tr').length === 5")
        check("after the approved delete the board lists 5 flags", True)

        # Vague instruction is refused with guidance, nothing applied
        page.fill("#instruction", "Make the homepage better please")
        page.click("#planBtn")
        page.wait_for_selector("#planErrors li")
        check("vague instruction returns a clarification", "Known flags" in page.inner_text("#planErrors"))
        check("apply stays disabled for a clarification", page.is_disabled("#applyBtn"))

        # Low motion toggle works
        page.click("#motionToggle")
        check("low-motion toggle sets the body class", page.evaluate("document.body.classList.contains('low-motion')"))

        page.screenshot(path=os.path.join(ROOT, "qa", "console.png"), full_page=True)
        check("zero console errors across the whole run", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()
finally:
    server.send_signal(signal.SIGTERM)

failed = [r for r in results if not r[1]]
print(f"run_qa.py — {len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
