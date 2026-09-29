PvP Alerts v159

Ported to Mindustry v158/v159 with erekir support.

Disclaimer: This mod was originally created by Xelo. JohnTing forked Xelo's repo, and I forked from JohnTing's fork. Credits to Xelo and JohnTing.

Mod functions:
- Enemy tech tree / production alerts (including erekir blocks)
- Count all units (Groups.unit iterator)
- Global power status
- /sync shortcut
- Quick vote kick
- Toggle lighting
- Damage alerts with pips
- AFK mining AI
- Ammo shape sprites (idea by JohnTing: hollow triangle for single-target, splash-radius ring for AoE)
- In-game auto-updater (stable / beta channels)

Removed from v136: Quick schematics, turret range view, ore scan, factory progress bars, steal unit, gamma AI button

Buttons (bottom-left bar):
- Units: count enemy units
- Light: toggle lighting
- Sync: send /sync
- Vote y: send /vote y
- Star: toggle ammo shape sprites

Chat commands:
- help, enable, disable, wipe, items, units, prefix, turretdmg, ammo, debug

Development:
- scripts/main.js is the only file with real logic; scripts/jotfunction.js holds the
  AFK mining AI and the enemy mouse-tracer overlay.
- The tracked-block alert table lives in exactly one place, registerTrackHandlers().
  Do not inline it back into ClientLoadEvent or clear() — that duplication is what
  previously let tracker coverage drift between map loads.
- Changes are validated by ~/maintenance/pvpvalidate.js, which executes the mod
  against stubbed Mindustry globals and diffs the tracked-block list against
  ~/maintenance/pvp-baseline.json. Run it before committing.
