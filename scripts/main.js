print("[green]PvP-Alerts v1.4.0 loaded!");
const jot = require("jotfunction");

var pvpDebug = false;
try { pvpDebug = Core.settings.getBool("pvpnotifs-debug", false); } catch(e) {}

function pvplog(msg) {
    if (!pvpDebug) return;
    try { Vars.ui.chatfrag.addMessage("[yellow][PvP] " + msg); } catch(e) {}
    try { Vars.ui.showInfoToast(msg, 4); } catch(e) {}
}

global.alerts = {};
var lastUnlockTable = null;
var lastUnlockLayout = null;

function popup(intable) {
    var table = new Table(Tex.button);
    table.update(() => {
        if (Vars.state.isMenu()) {
            table.remove();
            lastUnlockLayout = null;
            lastUnlockTable = null;
        }
    });
    table.margin(12);
    table.add(intable).padRight(8);
    table.pack();

    var container = Core.scene.table();
    container.top().add(table);
    container.setTranslation(0, table.getPrefHeight());
    container.actions(Actions.translateBy(0, -table.getPrefHeight(), 1.0, Interp.fade), Actions.delay(2.5),
        Actions.run(() => container.actions(Actions.translateBy(0, table.getPrefHeight(), 1, Interp.fade), Actions.run(() => {
            lastUnlockTable = null;
            lastUnlockLayout = null;
        }), Actions.remove())));
    lastUnlockTable = container;
    lastUnlockLayout = intable;
}

function chatColor(color) {
    return "[#" + color.toString() + "]";
}

function chatTeamColor(team) {
    return "[#" + team.color.toString() + "]";
}

function toBlockEmoji(block) {
    return String.fromCharCode(Fonts.getUnicode(block.name));
}

function getConstructingBlock(tile) {
    if (!tile || !tile.build) return Blocks.air;
    if (tile.build instanceof ConstructBlock.ConstructBuild) {
        return tile.build.cblock;
    }
    return tile.build.block;
}

var eventid = 0;
var techSummaryTable = null;
var techSummaryTimer = null;

var btnDragging = false;
var bDX = 0, bDY = 0;
var btnTable = null;

function eventLogInfo(team, message) {
    queue.add("E-" + eventid + " Team " + chatTeamColor(team) + team.name + "[white] " + message);
    eventid++;
}

function eventLogBlock(team, block, tile) {
    if (!tile) return;
    queue.add("E-" + eventid + " Team " + chatTeamColor(team) + team.name + "[white] has placed:" + block.localizedName + toBlockEmoji(block) + " at (" + tile.x + "," + tile.y + ")");
    eventid++;
}

function eventLog(team, tile) {
    if (!tile) return;
    queue.add("E-" + eventid + " Team " + chatTeamColor(team) + team.name + "[white] has placed:" + getConstructingBlock(tile).localizedName + " at (" + tile.x + "," + tile.y + ")");
    eventid++;
}

const Milestone = {
    name: "",
    complete: false,
    team: null,
    new(team, name) {
        var f = Object.create(Milestone);
        f.name = name;
        return f;
    }
};

const BlockBuildTracker = function(atile, block, tracker) {
    var tile = atile;
    if (!tile || !tile.build) return true;
    if (tile.build.block == block) {
        if ((tracker.buildfilter && tracker.buildfilter(tile.build)) || !tracker.buildfilter) {
            tracker.displayAlert(tile.build.team, block, tile);
        }
        return true;
    }
    if (!(tile.build instanceof ConstructBlock.ConstructBuild)) {
        return true;
    }
    return false;
};

const BlockTracker = {
    tile: null,
    tracker: null,
    milestone: null,
    block: null,
    done: false,
    repeatable: false,
    new(tile, tracker, milestone, block, repeatable) {
        var f = Object.create(BlockTracker);
        f.tile = tile;
        f.tracker = tracker;
        f.milestone = milestone;
        f.block = block;
        f.repeatable = repeatable;
        return f;
    },
    updateTrack() {
        var tile = this.tile;
        if (!this.repeatable) {
            if (this.milestone.complete) { this.done = true; return; }
            this.milestone.complete = this.tracker(tile, this.block, this);
        } else {
            this.done = this.tracker(tile, this.block, this);
        }
    },
    displayAlert(team, block, tile) {
        if (!this.customText) {
            eventLogBlock(team, block, tile);
        } else {
            eventLogInfo(team, this.customText(team, block, tile));
        }
    }
};

const BlockTrackHandler = {
    milestoneName: null,
    trackerFunc: null,
    block: null,
    repeatable: false,
    properties: {},
    new(milestoneName, trackerFunc, block, repeatable, properties) {
        var f = Object.create(BlockTrackHandler);
        f.milestoneName = milestoneName;
        f.block = block;
        f.trackerFunc = trackerFunc;
        f.repeatable = repeatable;
        f.properties = properties;
        return f;
    },
    processBuildingEvent(team, tile) {
        var block = getConstructingBlock(tile);
        if (block == this.block) {
            var teamach = getTeamAch(team);
            var milestone = teamach.getMilestone(this.milestoneName);
            if (!milestone.complete) {
                let tracker = BlockTracker.new(tile, this.trackerFunc, milestone, block, this.repeatable);
                for (var propid in this.properties) {
                    tracker[propid] = this.properties[propid];
                }
                addTracker(tracker);
            }
        }
    },
    getId() {
        return "m " + this.milestoneName + " : " + this.block.name;
    }
};

const TeamAchievement = {
    silicon: false,
    graphite: false,
    miningDrone: false,
    titanium: false,
    thorium: false,
    plast: false,
    phase: false,
    surge: false,
    foreshadow: false,
    units: null,
    team: null,
    milestones: null,
    new(team) {
        var f = Object.create(TeamAchievement);
        f.team = team;
        return f;
    },
    getMilestone(name) {
        if (!this.milestones) {
            this.milestones = ObjectMap.of(name, Milestone.new(this.team, name));
        }
        if (!this.milestones.get(name)) {
            this.milestones.put(name, Milestone.new(this.team, name));
        }
        return this.milestones.get(name);
    },
    processBuildingEvent(tile) {},
    processUnitCreateEvent(unit) {
        if (!this.units) {
            this.units = Seq.with(unit);
            eventLogInfo(this.team, "has started making " + unit.localizedName + toBlockEmoji(unit));
        }
        if (!this.units.contains(unit)) {
            this.units.add(unit);
            eventLogInfo(this.team, "has started making " + unit.localizedName + toBlockEmoji(unit));
        }
    }
};

var blocktrackhandle = null;
var trackers = new Seq();
var teams = null;

function addTrackHandler(bth) {
    if (!blocktrackhandle) {
        blocktrackhandle = {};
    }
    blocktrackhandle[bth.getId()] = bth;
}

function addTracker(tracker) {
    trackers.add(tracker);
}

function getTeamAch(team) {
    if (!teams) {
        teams = {};
    }
    var key = team.name || String(team);
    if (!teams[key]) {
        teams[key] = TeamAchievement.new(team);
    }
    return teams[key];
}

function inCamera(camera, x, y) {
    return (Math.abs(camera.position.x - x) < camera.width * 0.5 && Math.abs(camera.position.y - y) < camera.height * 0.5);
}

var alerticonlow;
var alerticonhigh;
var pipicon;
var pips = new Seq();

function triggerPip(x, y, s, m) {
    var trgg = false;
    pips.each(t => {
        if (trgg) return;
        if (t.retrigger(x, y, s, m)) {
            trgg = true;
        }
    });
    if (!trgg) {
        var pip = alertPip.new(x, y);
        pip.severity = s;
        pips.add(pip);
    }
    pips.sort(floatf(p => p.severity));
}

var alertPip = {
    x: 0,
    y: 0,
    severity: 0,
    shake: 5,
    animate: 0,
    life: 0,
    maxlife: 500,
    points: null,
    transition: 0,
    px: 0,
    py: 0,
    pang: 0,
    new(x, y) {
        var newpip = Object.create(alertPip);
        newpip.x = x;
        newpip.y = y;
        newpip.points = Seq.with(new Vec2(x, y));
        return newpip;
    },
    draw() {
        this.life++;
        this.maxlife = (Math.min(3000, 500 + this.severity * 500));
        let fade = Mathf.clamp((this.maxlife - this.life) * 0.01, 0, 1);

        this.shake /= 1.4;
        var camera = Core.camera;

        let col = Pal.accent;
        let icon = (this.severity < 2 ? alerticonlow : alerticonhigh);
        if (this.severity < 1) {
            col = Pal.accent.cpy().lerp(Pal.health, this.severity);
        } else if (this.severity < 3) {
            col = Pal.health;
        } else {
            col = (Time.time % 60 < 30 ? Pal.health : Color.white);
        }

        let camdist = Mathf.dst(this.x, this.y, camera.position.x, camera.position.y);
        let size = Math.max(0.5, 1.0 / (1.0 + 0.002 * camdist));
        this.animate += (size - this.animate) * 0.1;

        if (inCamera(camera, this.x, this.y) && camdist < 80) {
            if (this.transition >= 1) {
                this.px = this.x;
                this.py = this.y + 8;
                this.pang = 270;
            } else {
                this.transition = Mathf.clamp(this.transition + 0.05, 0, 1);
                this.px += (this.x - this.px) * 0.2;
                this.py += (this.y + 8 - this.py) * 0.2;
                this.pang += (270 - this.pang) * 0.2;
            }

            Draw.color(col);
            Draw.alpha(0.5);
            this.points.each(p => {
                Lines.line(this.px, this.py - 8, p.x, p.y);
            });
        } else {
            let dx = this.x - camera.position.x;
            let dy = this.y - camera.position.y;
            dx /= camdist;
            dy /= camdist;
            if (this.transition <= 0) {
                this.pang = Mathf.atan2(dx, dy) * Mathf.radiansToDegrees;
                this.px = camera.position.x + dx * 20;
                this.py = camera.position.y + dy * 20;
            } else {
                this.transition = Mathf.clamp(this.transition - 0.05, 0, 1);
                this.px += (camera.position.x + dx * 20 - this.px) * 0.3;
                this.py += (camera.position.y + dy * 20 - this.py) * 0.3;
                this.pang += (Mathf.atan2(dx, dy) * Mathf.radiansToDegrees - this.pang) * 0.3;
            }
        }

        Draw.color(Pal.darkerGray);
        Fill.circle(this.px, this.py, (22 / 4) * this.animate);
        Draw.color(col);
        Draw.alpha(fade);
        Draw.rect(pipicon, this.px, this.py, 12 * this.animate, 12 * this.animate, this.pang);
        Draw.rect(icon, this.px + Mathf.range(this.shake), this.py + Mathf.range(this.shake), 4 * this.animate, 4 * this.animate);
    },
    retrigger(x, y, s, max) {
        if (Mathf.dst2(x - this.x, y - this.y) < (100 * 100)) {
            if (this.severity < max) {
                this.severity += s;
                this.severity = Math.min(max, this.severity);
                this.life = 0;
            }
            this.shake = 5;
            this.life *= 0.8;
            this.points.add(new Vec2(x, y));
            return true;
        }
        return false;
    }
};

var inConstruction = new Seq();
var queue = new Seq();
var prefix = "/t";
var prevsent = 0;
var enabled = false;

Events.on(EventType.BlockDestroyEvent, cons(e => {
    var tile = e.tile;
    if (!tile) return;

    if (tile.build instanceof CoreBlock.CoreBuild) {
        if (tile.team() == Vars.player.team()) {
            queue.add("[red]!!Core at (" + tile.x + "," + tile.y + ") was lost!!");
        } else {
            eventLogInfo(tile.team(), "has lost a core at (" + tile.x + "," + tile.y + ")");
        }
    }

    if (tile.team() == Vars.player.team()) {
        var severe = 0.01;
        if (tile.build.block.category == Category.distribution) {
            severe *= 1;
        } else if (tile.build.block.category == Category.defense) {
            severe *= Math.min(5 * tile.build.block.size, 3);
        } else if (tile.build.block.category == Category.turret) {
            severe *= Math.min(10 * tile.build.block.size, 3);
        } else if (tile.build.block.category == Category.power) {
            if (tile.build.block instanceof PowerGenerator) {
                severe *= Math.min(150 / tile.build.block.size, 3);
            } else if (tile.build.block instanceof PowerNode) {
                severe *= Math.min(3 / tile.build.block.size, 3);
            } else {
                severe *= Math.min(50 / tile.build.block.size, 3);
            }
        } else if (tile.build.block.category == Category.logic) {
            severe *= Math.min(10 / tile.build.block.size, 3);
        } else if (tile.build.block.category == Category.production) {
            severe *= Math.min(tile.build.block.size == 2 ? 3 : 30 / tile.build.block.size, 3);
        } else if (tile.build.block.category == Category.crafting) {
            severe *= Math.min(30 / tile.build.block.size, 3);
        } else if (tile.build.block.category == Category.units) {
            severe *= Math.min(200 / tile.build.block.size, 3);
        } else if (tile.build.block.category == Category.effect) {
            severe *= Math.min(5 / tile.build.block.size, 3);
        }
        triggerPip(tile.getX(), tile.getY(), severe, 3);
    }
}));

Events.on(EventType.ClientLoadEvent,
    cons(e => {
        alerticonlow = Core.atlas.find("pvpnotifs-alert-0") || Core.atlas.find("icon-remove");
        alerticonhigh = Core.atlas.find("pvpnotifs-alert-1") || Core.atlas.find("icon-cancel");
        pipicon = Core.atlas.find("pvpnotifs-pip") || Core.atlas.find("pip");

        addTrackHandler(BlockTrackHandler.new("graphite", BlockBuildTracker, Blocks.graphitePress, false, {
            "customText": function(team, block, tile) {
                return "has started graphite production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.graphite);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("silicon", BlockBuildTracker, Blocks.siliconSmelter, false, {
            "customText": function(team, block, tile) {
                return "has started silicon production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.silicon);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("siliconCrucible", BlockBuildTracker, Blocks.siliconCrucible, false, {
            "customText": function(team, block, tile) {
                return "has started mass silicon production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.silicon);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("kiln", BlockBuildTracker, Blocks.kiln, false, {
            "customText": function(team, block, tile) {
                return "has started metaglass production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.metaglass);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("plast", BlockBuildTracker, Blocks.plastaniumCompressor, false, {
            "customText": function(team, block, tile) {
                return "has started plastanium production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.plastanium);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("phase", BlockBuildTracker, Blocks.phaseWeaver, false, {
            "customText": function(team, block, tile) {
                return "has started phase production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.phaseFabric);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("surge", BlockBuildTracker, Blocks.surgeSmelter, false, {
            "customText": function(team, block, tile) {
                return "has started surge production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.surgeAlloy);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("pyratite", BlockBuildTracker, Blocks.pyratiteMixer, false, {
            "customText": function(team, block, tile) {
                return "has started pyratite production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.pyratite);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("blast", BlockBuildTracker, Blocks.blastMixer, false, {
            "customText": function(team, block, tile) {
                return "has started blast production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.blastCompound);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("foreshadow", BlockBuildTracker, Blocks.foreshadow, false, {}));

        addTrackHandler(BlockTrackHandler.new("siliconArcFurnace", BlockBuildTracker, Blocks.siliconArcFurnace, false, {
            "customText": function(team, block, tile) {
                return "has started silicon production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.silicon);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("carbideCrucible", BlockBuildTracker, Blocks.carbideCrucible, false, {
            "customText": function(team, block, tile) {
                return "has started carbide production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.carbide);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("surgeCrucible", BlockBuildTracker, Blocks.surgeCrucible, false, {
            "customText": function(team, block, tile) {
                return "has started surge production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.surgeAlloy);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("phaseSynthesizer", BlockBuildTracker, Blocks.phaseSynthesizer, false, {
            "customText": function(team, block, tile) {
                return "has started phase production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.phaseFabric);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("cyanogenSynthesizer", BlockBuildTracker, Blocks.cyanogenSynthesizer, false, {
            "customText": function(team, block, tile) {
                return "has started cyanogen production " + toBlockEmoji(block);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("electrolyzer", BlockBuildTracker, Blocks.electrolyzer, false, {
            "customText": function(team, block, tile) {
                return "has started electrolysis " + toBlockEmoji(block);
            }
        }));
        addTrackHandler(BlockTrackHandler.new("slagCentrifuge", BlockBuildTracker, Blocks.slagCentrifuge, false, {
            "customText": function(team, block, tile) {
                return "has started slag centrifuge " + toBlockEmoji(block);
            }
        }));

        var erekirDrillEvent = {
            "customText": function(team, block, tile) {
                var build = tile.build;
                var item = build ? build.dominantItem : null;
                var resName = item ? item.localizedName : "ore";
                return "has started " + resName + " mining " + toBlockEmoji(block) + (item ? "" + toBlockEmoji(item) : "");
            }
        };
        addTrackHandler(BlockTrackHandler.new("plasmaBore", BlockBuildTracker, Blocks.plasmaBore, false, erekirDrillEvent));
        addTrackHandler(BlockTrackHandler.new("largePlasmaBore", BlockBuildTracker, Blocks.largePlasmaBore, false, erekirDrillEvent));
        addTrackHandler(BlockTrackHandler.new("impactDrill", BlockBuildTracker, Blocks.impactDrill, false, erekirDrillEvent));
        addTrackHandler(BlockTrackHandler.new("eruptionDrill", BlockBuildTracker, Blocks.eruptionDrill, false, erekirDrillEvent));

        Vars.content.blocks().each((e2) => {
            if (e2 instanceof UnitFactory) {
                addTrackHandler(BlockTrackHandler.new(e2.name, BlockBuildTracker, e2, false, {}));
            }
            if (e2 instanceof Reconstructor) {
                addTrackHandler(BlockTrackHandler.new(e2.name, BlockBuildTracker, e2, false, {}));
            }
        });

        var drillEvent = {
            "customText": function(team, block, tile) {
                var build = tile.build;
                var item = build ? build.dominantItem : null;
                var resName = item ? item.localizedName : "ore";
                return "has started " + resName + " mining " + toBlockEmoji(block) + (item ? "" + toBlockEmoji(item) : "");
            }
        };
        addTrackHandler(BlockTrackHandler.new("pneumaticDrill", BlockBuildTracker, Blocks.pneumaticDrill, false, drillEvent));
        addTrackHandler(BlockTrackHandler.new("laserDrill", BlockBuildTracker, Blocks.laserDrill, false, drillEvent));
        addTrackHandler(BlockTrackHandler.new("blastDrill", BlockBuildTracker, Blocks.blastDrill, false, drillEvent));

        try {
            Vars.mods.getScripts().runConsole("this.alert = this.global.alerts.onChat");
        } catch (err) {
            print("PvP-Alerts: failed to expose onChat: " + err);
        }

        var coreplus = (t) => {
            if (!t) return;
            t.row();
            var powbar = new Bar("Power", Pal.accent, floatp(() => { return getBatLevel(); }));
            powbar.set(prov(() => { return "Power: " + (powerBalance() >= 0 ? "+" : "") + Strings.fixed(powerBalance() * 60.0, 1); }), floatp(() => { return getBatLevel(); }), Pal.accent);
            t.add(powbar).width(200).height(25).pad(4);
        };
        coreplus(Vars.ui.hudGroup.find(boolf(e => { return e instanceof CoreItemsDisplay; })));

        var savedBtnX = Core.settings.getInt("pvpnotifs-bx", 4);
        var savedBtnY = Core.settings.getInt("pvpnotifs-by", 4);

        Core.app.post(() => {
        var t = new Table();
        t.background(Styles.black6);
        t.touchable = Touchable.enabled;
        t.bottom().left().margin(4);
        btnTable = t;

        var style = Styles.clearTogglei;

        var dragBtn = t.button(Icon.move, Styles.clearNonei, run(() => {
        })).width(46).height(46).name("drag").tooltip("drag to move").get();

        t.button(Icon.units, style, run(() => {
            onChat(Vars.player ? Vars.player.name : "local", "units");
        })).width(46).height(46).name("units").tooltip("count enemy units");

        t.button(Icon.refresh, style, run(() => {
            Call.sendChatMessage("/sync");
        })).width(46).height(46).name("sync").tooltip("/sync");

        var voteLongFired = false;
        var voteTimer = null;
        var voteBtn = t.button(Icon.hammer, style, run(() => {})).width(46).height(46).name("votekick").tooltip("vote y (hold / right-click to edit)").get();
        voteBtn.addListener(extend(InputListener, {
            touchDown: function(event, x, y, pointer, button) {
                if (button == 1 || button == 2) {
                    showVoteEditor();
                    return true;
                }
                voteLongFired = false;
                voteTimer = Timer.schedule(java.lang.Runnable({ run: function() {
                    voteLongFired = true;
                    showVoteEditor();
                }}), 0.5);
                return true;
            },
            touchUp: function(event, x, y, pointer, button) {
                if (voteTimer) { voteTimer.cancel(); voteTimer = null; }
                if (!voteLongFired) {
                    Call.sendChatMessage(Core.settings.getString("pvpnotifs-vote", "/vote y"));
                }
                voteLongFired = false;
                return true;
            }
        }));

        t.button(Icon.units, style, run(() => {
            showTechSummary();
        })).width(46).height(46).name("techsummary").tooltip("enemy tech summary");

        var dmgBtn = t.button(Icon.star, Styles.clearTogglei, run(() => {
            pvplog("STAR PRESSED! was=" + showTurretDmg);
            showTurretDmg = !showTurretDmg;
            dmgBtn.setChecked(showTurretDmg);
            Core.settings.put("pvpnotifs-showturretdmg", showTurretDmg);
            syncAmmoSprites();
        })).width(46).height(46).name("turretdmg").tooltip("ammo shapes: replaces your team's bullet sprites with yellow triangles (single-target) / orange circles (AoE) — lighter than stock sprites").get();
        dmgBtn.setChecked(showTurretDmg);
        dmgBtnRef = dmgBtn;

        var updateLongFired = false;
        var updateTimer = null;
        var updateBtn = t.button(Icon.settings, style, run(() => {})).width(46).height(46).name("update").tooltip("check for updates (hold / right-click to choose branch)").get();
        updateBtn.addListener(extend(InputListener, {
            touchDown: function(event, x, y, pointer, button) {
                if (button == 1 || button == 2) {
                    showUpdateConfig();
                    return true;
                }
                updateLongFired = false;
                updateTimer = Timer.schedule(java.lang.Runnable({ run: function() {
                    updateLongFired = true;
                    showUpdateConfig();
                }}), 0.5);
                return true;
            },
            touchUp: function(event, x, y, pointer, button) {
                if (updateTimer) { updateTimer.cancel(); updateTimer = null; }
                if (!updateLongFired) {
                    checkForUpdates();
                }
                updateLongFired = false;
                return true;
            }
        }));

        t.pack();
        t.setPosition(savedBtnX, savedBtnY);
        Vars.ui.hudGroup.addChild(t);

        dragBtn.addListener(extend(InputListener, {
            touchDown: function(event, x, y, pointer, _btn) {
                bDX = event.stageX;
                bDY = event.stageY;
                btnDragging = true;
                return true;
            },
            touchDragged: function(event, x, y, pointer) {
                if (btnDragging) {
                    var dx = event.stageX - bDX;
                    var dy = event.stageY - bDY;
                    t.moveBy(dx, dy);
                    var sw = Core.graphics.getWidth();
                    var sh = Core.graphics.getHeight();
                    var bw = btnTable.getWidth();
                    var bh = btnTable.getHeight();
                    if (t.x < 0) t.x = 0;
                    if (t.y < 0) t.y = 0;
                    if (t.x + bw > sw) t.x = sw - bw;
                    if (t.y + bh > sh) t.y = sh - bh;
                    savedBtnX = t.x;
                    savedBtnY = t.y;
                    bDX = event.stageX;
                    bDY = event.stageY;
                }
            },
            touchUp: function(event, x, y, pointer, _btn) {
                if (btnDragging) {
                    btnDragging = false;
                    savedBtnX = t.x;
                    savedBtnY = t.y;
                    Core.settings.put("pvpnotifs-bx", new java.lang.Integer(Math.round(savedBtnX)));
                    Core.settings.put("pvpnotifs-by", new java.lang.Integer(Math.round(savedBtnY)));
                }
            }
        }));
        });
    }));

var playerMiningAI = extend(AIController, {
    mining: true,
    targetItem: null,
    ore: null,
    unitS(u) {
        if (this.unit == u) return;
        this.unit = u;
        this.init();
    },
    updateMovement() {
        let unit = this.unit;
        var core = unit.closestCore();
        if (!(unit.canMine()) || core == null) return;

        if (unit.mineTile != null && !unit.mineTile.within(unit, unit.type.range)) {
            unit.mineTile = null;
        }

        if (this.mining) {
            if (this.timer.get(1, 240) || this.targetItem == null) {
                let mineItems = Seq.with(Items.copper, Items.lead, Items.coal, Items.titanium, Items.thorium);
                this.targetItem = mineItems.min(boolf(i => Vars.indexer.hasOre(i) && unit.canMine(i)), floatf(i => core.items.get(i) - jot.orePriority(i)));
            }
            if (this.targetItem != null && core.acceptStack(this.targetItem, 1, unit) == 0) {
                unit.clearItem();
                unit.mineTile = null;
                return;
            }
            if (unit.stack.amount >= unit.type.itemCapacity || (this.targetItem != null && !unit.acceptsItem(this.targetItem))) {
                this.mining = false;
            } else {
                if (this.targetItem != null) {
                    this.ore = Vars.indexer.findClosestOre(core.x, core.y, this.targetItem);
                }
                if (this.ore != null) {
                    this.moveTo(this.ore, unit.type.range / 4, 20);
                    if (unit.within(this.ore, unit.type.range * 0.5)) {
                        unit.mineTile = this.ore;
                    }
                    if (this.ore.block() != Blocks.air) {
                        this.mining = false;
                    }
                }
            }
        } else {
            unit.mineTile = null;
            if (unit.stack.amount == 0) {
                this.mining = true;
                return;
            }
            if (unit.within(core, unit.type.range)) {
                if (core.acceptStack(unit.stack.item, unit.stack.amount, unit) > 0) {
                    try {
                        Call.transferInventory(Vars.player, core);
                    } catch (err) {
                        Call.transferItemTo(unit, unit.stack.item, unit.stack.amount, unit.x, unit.y, core);
                    }
                }
                this.mining = true;
            }
            this.circle(core, unit.type.range / 1.8);
        }
    }
});

var playerAI = null;
var powerbal = 0;
var stored = 0;
var battery = 0.01;

function powerBalance() { return powerbal; }
function getBatLevel() { return stored / battery; }


function iterateOver(iterator, func) {
    while (iterator.hasNext()) {
        func(iterator.next());
    }
}


// --- ammo sprite replacement (v1.2.3) ---
// Swaps BasicBulletType sprites for baked textures: hollow triangle (single-target),
// ring sized to the type's real splashDamageRadius (AoE). Zero per-frame JS work.
// Baking uses ONLY fillCircle-with-color (the primitive proven to work in 1.2.0);
// no setColor / blending / transparent-punch calls that can throw and abort the swap.

var ammoApplied = false;
var ammoBuilt = false;
var ammoOrigSaved = false;
var triRegion = null;
var ringCache = {};
var ammoSaved = [];
var ammoStatus = "not applied yet";
var ammoErrShown = false;

// Single filled circle — arc Pixmap only accepts PACKED INT (0xRRGGBBAA), NOT Color objects.
function ammoDot(pm, x, y, r, packedRGBA) {
    pm.fillCircle(x | 0, y | 0, Math.max(r | 0, 1), packedRGBA);
}

// Stamps overlapping dots along a line segment -> thick stroke.
function stampLine(pm, x1, y1, x2, y2, r, color) {
    var dx = x2 - x1, dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(Math.ceil(dist / (r * 0.9)), 2);
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        ammoDot(pm, x1 + dx * t, y1 + dy * t, r, color);
    }
}

// Stamps dots around a circle -> ring outline.
function stampRing(pm, cx, cy, radius, dotR, color) {
    var circumference = 2 * Math.PI * radius;
    var steps = Math.max(Math.ceil(circumference / (dotR * 0.8)), 8);
    for (var j = 0; j < steps; j++) {
        var ang = (j / steps) * 2 * Math.PI;
        ammoDot(pm, cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius, dotR, color);
    }
}

function ensureAmmoTextures() {
    if (ammoBuilt) return;
    try {
        var TAN = 0xddcc88ff | 0;  // muted tan/light yellow, plain
        var pt = new Pixmap(64, 64);
        stampLine(pt, 3, 61, 61, 61, 3, TAN);   // base
        stampLine(pt, 61, 61, 32, 3, 3, TAN);   // right edge
        stampLine(pt, 32, 3, 3, 61, 3, TAN);    // left edge
        triRegion = new TextureRegion(new Texture(pt));
        pt.dispose();
        ammoBuilt = true;
        ammoStatus = "baked ok";
    } catch (e) {
        ammoStatus = "BAKE FAILED: " + e;
        Log.err("PvP-Alerts ammo bake failed", e);
        if (!ammoErrShown) {
            ammoErrShown = true;
            try { Vars.ui.showErrorMessage("PvP-Alerts sticker bake failed:\n" + e); } catch (e2) {}
        }
    }
}

// Ring whose diameter equals splashDamageRadius after being stretched into the
// bullet's width x height box. Cached/quantized so only a handful of textures exist.
function getRingRegion(radiusUnits, boxMaxUnits) {
    try {
        if (!ringCache._ok) { ensureAmmoTextures(); if (!ammoBuilt) return null; }
        var TAN = 0xddcc88ff | 0;  // muted tan, same as triangle
        var frac = Math.min(Math.max(radiusUnits / Math.max(boxMaxUnits, 1), 0.12), 1.0);
        var key = Math.round(frac * 24);
        if (ringCache[key]) return ringCache[key];
        var dotR = 3;  // thin stroke
        var ringR = Math.max(Math.round(frac * 26), 8);
        var pc = new Pixmap(64, 64);
        stampRing(pc, 32, 32, ringR, dotR, TAN);
        var tex = new Texture(pc);
        var reg = new TextureRegion(tex);
        pc.dispose();
        ringCache[key] = reg;
        return reg;
    } catch (e) { return null; }
}

function findField(obj, name) {
    // Get real java.lang.Class - either from instance.getClass() or Class.forName()
    var realCls = null;
    try { realCls = obj.getClass(); } catch (e1) {}
    if (realCls == null) {
        try { realCls = java.lang.Class.forName(obj.getName ? obj.getName() : "" + obj); } catch (e2) {}
    }
    if (realCls == null) { pvplog("findField: cannot get Class for " + obj); return null; }
    // Try direct getDeclaredField
    try { var f = realCls.getDeclaredField(name); f.setAccessible(true); return f; } catch (e) {}
    // Walk superclasses
    try {
        var c = realCls.getSuperclass();
        while (c != null) {
            try { var f = c.getDeclaredField(name); f.setAccessible(true); return f; } catch (e2) {}
            try { c = c.getSuperclass(); } catch (e3) { break; }
        }
    } catch (e) {}
    // Last resort: dump all fields
    try {
        var fields = realCls.getDeclaredFields();
        var names = [];
        for (var i = 0; i < fields.length; i++) names.push("" + fields[i].getName());
        pvplog("fields on " + realCls.getSimpleName() + ": " + names.join(", "));
    } catch (e) { pvplog("dump fields err: " + e); }
    return null;
}

function applyAmmoSprites() {
    pvplog("applyAmmo: called");
    try {
        if (!Vars.content || !Vars.content.bullets || Vars.content.bullets().size == 0) { ammoStatus = "waiting: content not loaded"; pvplog("ammo: content not loaded yet"); return; }
    } catch (e) { ammoStatus = "waiting: content error " + e; pvplog("ammo: content error " + e); return; }
    ensureAmmoTextures();
    if (!ammoBuilt) { pvplog("ammo: bake failed"); return; }
    try {
        var BBT = Packages.mindustry.entities.bullet.BasicBulletType;
        var list = Vars.content.bullets();
        var swapped = 0, skipped = 0;
        // Find a BasicBulletType instance for reflection
        var sample = null;
        for (var si = 0; si < list.size; si++) {
            try { if (list.get(si) instanceof BBT) { sample = list.get(si); break; } } catch (e) {}
        }
        if (sample == null) { pvplog("ammo: no BasicBulletType instances found"); return; }
        var frontField = findField(sample, "frontRegion");
        var backField = findField(sample, "backRegion");
        pvplog("ammo: frontField=" + (frontField != null) + " backField=" + (backField != null) + " bullets=" + list.size);
        if (frontField == null) { ammoStatus = "FAILED: cannot find frontRegion field"; pvplog("ammo: " + ammoStatus); return; }
        for (var i = 0; i < list.size; i++) {
            var ty = list.get(i);
            try {
                var isBBT = (ty instanceof BBT);
                if (!isBBT) { skipped++; continue; }
                var isAoE = (ty.splashDamage > 0) || (ty.splashDamageRadius > 0);
                var reg = triRegion;
                if (isAoE) {
                    var R = ty.splashDamageRadius > 0 ? ty.splashDamageRadius : Math.max(ty.splashDamage, 4) * 0.6;
                    var boxMax = Math.max(ty.width, ty.height, 1);
                    reg = getRingRegion(R, boxMax);
                    if (reg == null) reg = triRegion;
                }
                if (reg == null) { skipped++; continue; } // don't set null region
                // Save originals only once
                if (!ammoOrigSaved) {
                    var origFront = frontField.get(ty);
                    var origBack = null;
                    if (backField != null) origBack = backField.get(ty);
                    ammoSaved.push([ty, origFront, origBack]);
                }
                // Always set (survives content reloads)
                frontField.set(ty, reg);
                if (backField != null) {
                    var curBack = backField.get(ty);
                    if (curBack != null) backField.set(ty, reg);
                }
                swapped++;
            } catch (e2) { pvplog("ammo: swap err on " + ty + ": " + e2); }
        }
        ammoApplied = true;
        ammoOrigSaved = true;
        ammoStatus = "swapped " + swapped + " bullet types (" + skipped + " non-basic skipped)";
        pvplog("ammo: " + ammoStatus);
    } catch (e) {
        ammoStatus = "SWAP FAILED: " + e;
        pvplog("ammo: " + ammoStatus);
        Log.err("PvP-Alerts ammo sprite swap failed", e);
    }
}

function restoreAmmoSprites() {
    if (!ammoApplied) return;
    try {
        var frontField = null, backField = null;
        if (ammoSaved.length > 0) {
            frontField = findField(ammoSaved[0][0], "frontRegion");
            backField = findField(ammoSaved[0][0], "backRegion");
        }
        for (var i = 0; i < ammoSaved.length; i++) {
            var r = ammoSaved[i];
            try { if (frontField) frontField.set(r[0], r[1]); } catch (e) {}
            try { if (backField && r[2] != null) backField.set(r[0], r[2]); } catch (e2) {}
        }
    } catch (e) {}
    ammoSaved = [];
    ammoApplied = false;
}

function syncAmmoSprites() {
    pvplog("syncAmmo: on=" + showTurretDmg + " built=" + ammoBuilt);
    if (showTurretDmg) applyAmmoSprites(); else restoreAmmoSprites();
}

Events.run(Trigger.drawOver, () => {
    try {
        jot.drawMouse();

        Draw.draw(Layer.overlayUI + 0.01, run(() => {
            pips.each(t => {
                try { t.draw(); } catch (e) { Log.err("PvP-Alerts pip draw failed", e); }
            });
        }));
    } catch (e) { Log.err("PvP-Alerts drawOver failed", e); }
});

var glitch = false;
var delayglitch = 0;
var showTurretDmg = false;
try { showTurretDmg = Core.settings.getBool("pvpnotifs-showturretdmg", false); } catch (e) {}
var dmgBtnRef = null;
try { syncAmmoSprites(); } catch (e) {}

Events.run(Trigger.update, () => {
    try {
    pips = pips.select((t) => { return t.life < t.maxlife; });
    anticommandspam = anticommandspam.select((t) => { return t.timer >= 0; });
    anticommandspam.each(t => {
        t.timer += Time.delta;
        if (t.timer > 600) {
            eventLogInfo(t.team, "has issued command to attack.");
            t.timer = -1;
        }
    });

    if (playerAI && Vars.player.unit() && Vars.player.unit().type) {
        try {
            let base = Math.min(Vars.player.team().items().get(Items.copper), Vars.player.team().items().get(Items.lead));
            base = Math.min(base, Vars.player.team().items().get(Items.coal));

            if ((base < 1000 && playerAI instanceof BuilderAI) || Vars.player.unit().type.buildSpeed <= 0) {
                playerAI = playerMiningAI;
            } else if (base >= 1000 && playerAI == playerMiningAI) {
                playerAI = new BuilderAI();
            }
            if (playerAI == playerMiningAI) {
                playerAI.unitS(Vars.player.unit());
            } else {
                playerAI.unit(Vars.player.unit());
            }
            playerAI.updateUnit();
        } catch (err) {
            playerAI = null;
            print("PvP-Alerts: AI error (multiplayer may restrict control): " + err);
        }
    }

    if (wasCleared) {
        var be = enabled;
        enabled = false;
        update();
        while (!queue.isEmpty()) {
            if (Version.build >= 132) {
                Vars.ui.chatfrag.addMessage("[red]PvP-Alerts: " + queue.pop());
            } else {
                Vars.ui.chatfrag.addMessage(queue.pop(), "[red]PvP-Alerts");
            }
        }
        enabled = be;
        wasCleared = false;
    }


    if (glitch) {
        let mv = Vars.control.input.movement;
        Vars.player.unit().vel.x = mv.x * 10;
        Vars.player.unit().vel.y = mv.y * 10;
    }
    delayglitch++;

    update();

    var gridSeq = new Seq();
    battery = 0.01;
    stored = 0;
    powerbal = 0;

    let tilecons = (c) => {
        var build = c;
        if (build && build.build) build = build.build;
        if (!build || !build.power) return;
        let graph = build.power.graph;
        if (!graph) return;
        if (!gridSeq.contains(graph)) {
            gridSeq.add(graph);
            stored += graph.getBatteryStored();
            battery += graph.getTotalBatteryCapacity();
            powerbal += graph.getPowerBalance();
        }
    };

    iterateOver(Vars.indexer.getFlagged(Vars.player.team(), BlockFlag.generator).iterator(), tilecons);
    iterateOver(Vars.indexer.getFlagged(Vars.player.team(), BlockFlag.reactor).iterator(), tilecons);
    // Brute-force: re-apply swap every tick in case content load reset it
    if (showTurretDmg && ammoBuilt) {
        try { applyAmmoSprites(); } catch (e0) {}
    }

    } catch (e) { Log.err("PvP-Alerts update loop failed", e); }
});

var prevmap = "";

Events.on(EventType.WorldLoadEvent, e => {
    if (Vars.state.map.name() != prevmap) {
        clear();
        prevmap = Vars.state.map.name();
        pips.clear();
    }
});

function update() {
    if (!queue.isEmpty()) {
        if (enabled) {
            if (prevsent > 120) {
                Call.sendChatMessage(prefix + " " + queue.pop());
                prevsent = 0;
            }
        } else {
            if (Version.build >= 132) {
                Vars.ui.chatfrag.addMessage("[red]PvP-Alerts: " + queue.pop());
            } else {
                Vars.ui.chatfrag.addMessage(queue.pop(), "[red]PvP-Alerts");
            }
        }
    }
    prevsent += Time.delta;

    trackers.each((t) => {
        t.updateTrack();
    });
    trackers = trackers.select((t) => { return !t.done; });
}

var wasCleared = false;
var allTeams = new Seq();

function clear() {
    anticommandspam.clear();
    eventid = 0;
    queue.clear();
    trackers.clear();
    allTeams.clear();
    if (teams) {
        var keys = Object.keys(teams);
        for (var i = 0; i < keys.length; i++) {
            delete teams[keys[i]];
        }
    }
    teams = null;
    blocktrackhandle = null;

    addTrackHandler(BlockTrackHandler.new("graphite", BlockBuildTracker, Blocks.graphitePress, false, {
        "customText": function(team, block, tile) {
            return "has started graphite production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.graphite);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("silicon", BlockBuildTracker, Blocks.siliconSmelter, false, {
        "customText": function(team, block, tile) {
            return "has started silicon production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.silicon);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("siliconCrucible", BlockBuildTracker, Blocks.siliconCrucible, false, {
        "customText": function(team, block, tile) {
            return "has started mass silicon production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.silicon);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("kiln", BlockBuildTracker, Blocks.kiln, false, {
        "customText": function(team, block, tile) {
            return "has started metaglass production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.metaglass);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("plast", BlockBuildTracker, Blocks.plastaniumCompressor, false, {
        "customText": function(team, block, tile) {
            return "has started plastanium production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.plastanium);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("phase", BlockBuildTracker, Blocks.phaseWeaver, false, {
        "customText": function(team, block, tile) {
            return "has started phase production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.phaseFabric);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("surge", BlockBuildTracker, Blocks.surgeSmelter, false, {
        "customText": function(team, block, tile) {
            return "has started surge production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.surgeAlloy);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("pyratite", BlockBuildTracker, Blocks.pyratiteMixer, false, {
        "customText": function(team, block, tile) {
            return "has started pyratite production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.pyratite);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("blast", BlockBuildTracker, Blocks.blastMixer, false, {
        "customText": function(team, block, tile) {
            return "has started blast production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.blastCompound);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("foreshadow", BlockBuildTracker, Blocks.foreshadow, false, {}));

    addTrackHandler(BlockTrackHandler.new("siliconArcFurnace", BlockBuildTracker, Blocks.siliconArcFurnace, false, {
        "customText": function(team, block, tile) {
            return "has started silicon production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.silicon);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("carbideCrucible", BlockBuildTracker, Blocks.carbideCrucible, false, {
        "customText": function(team, block, tile) {
            return "has started carbide production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.carbide);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("surgeCrucible", BlockBuildTracker, Blocks.surgeCrucible, false, {
        "customText": function(team, block, tile) {
            return "has started surge production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.surgeAlloy);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("phaseSynthesizer", BlockBuildTracker, Blocks.phaseSynthesizer, false, {
        "customText": function(team, block, tile) {
            return "has started phase production " + toBlockEmoji(block) + "" + toBlockEmoji(Items.phaseFabric);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("cyanogenSynthesizer", BlockBuildTracker, Blocks.cyanogenSynthesizer, false, {
        "customText": function(team, block, tile) {
            return "has started cyanogen production " + toBlockEmoji(block);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("electrolyzer", BlockBuildTracker, Blocks.electrolyzer, false, {
        "customText": function(team, block, tile) {
            return "has started electrolysis " + toBlockEmoji(block);
        }
    }));
    addTrackHandler(BlockTrackHandler.new("slagCentrifuge", BlockBuildTracker, Blocks.slagCentrifuge, false, {
        "customText": function(team, block, tile) {
            return "has started slag centrifuge " + toBlockEmoji(block);
        }
    }));

    var erekirDrillEvent = {
        "customText": function(team, block, tile) {
            var build = tile.build;
            var item = build ? build.dominantItem : null;
            var resName = item ? item.localizedName : "ore";
            return "has started " + resName + " mining " + toBlockEmoji(block) + (item ? "" + toBlockEmoji(item) : "");
        }
    };
    addTrackHandler(BlockTrackHandler.new("plasmaBore", BlockBuildTracker, Blocks.plasmaBore, false, erekirDrillEvent));
    addTrackHandler(BlockTrackHandler.new("largePlasmaBore", BlockBuildTracker, Blocks.largePlasmaBore, false, erekirDrillEvent));
    addTrackHandler(BlockTrackHandler.new("impactDrill", BlockBuildTracker, Blocks.impactDrill, false, erekirDrillEvent));
    addTrackHandler(BlockTrackHandler.new("eruptionDrill", BlockBuildTracker, Blocks.eruptionDrill, false, erekirDrillEvent));

    Vars.content.blocks().each((e2) => {
        if (e2 instanceof UnitFactory) {
            addTrackHandler(BlockTrackHandler.new(e2.name, BlockBuildTracker, e2, false, {}));
        }
        if (e2 instanceof Reconstructor) {
            addTrackHandler(BlockTrackHandler.new(e2.name, BlockBuildTracker, e2, false, {
                "customText": function(team, block, tile) {
                    return "can now make Tier-" + Math.round((block.size + 1) * 0.5) + " units" + toBlockEmoji(block);
                }
            }));
        }
    });

    var drillEvent = {
        "customText": function(team, block, tile) {
            var build = tile.build;
            var item = build ? build.dominantItem : null;
            var resName = item ? item.localizedName : "ore";
            return "has started " + resName + " mining " + toBlockEmoji(block) + (item ? "" + toBlockEmoji(item) : "");
        }
    };
    addTrackHandler(BlockTrackHandler.new("pneumaticDrill", BlockBuildTracker, Blocks.pneumaticDrill, false, drillEvent));
    addTrackHandler(BlockTrackHandler.new("laserDrill", BlockBuildTracker, Blocks.laserDrill, false, drillEvent));
    addTrackHandler(BlockTrackHandler.new("blastDrill", BlockBuildTracker, Blocks.blastDrill, false, drillEvent));

    wasCleared = true;

    Vars.world.tiles.each((x, y) => {
        var tile = Vars.world.tiles.getn(x, y);
        if (!tile) return;
        if (tile.team() !== Team.derelict) {
            if (tile.team() !== Vars.player.team() && tile.team().core()) {
                if (blocktrackhandle) {
                    var keys2 = Object.keys(blocktrackhandle);
                    for (var i = 0; i < keys2.length; i++) {
                        blocktrackhandle[keys2[i]].processBuildingEvent(tile.team(), tile);
                    }
                }
            }
            if (!allTeams.contains(tile.team())) {
                allTeams.add(tile.team());
            }
        }
    });
}

Events.on(EventType.BlockBuildBeginEvent, e => {
    var team = e.team;
    if (!e.breaking && e.team != Vars.player.team()) {
        getTeamAch(e.team).processBuildingEvent(e.tile);
        if (blocktrackhandle) {
            var keys = Object.keys(blocktrackhandle);
            for (var i = 0; i < keys.length; i++) {
                blocktrackhandle[keys[i]].processBuildingEvent(team, e.tile);
            }
        }
    }
    if (!allTeams.contains(team)) {
        allTeams.add(team);
    }
});

Events.on(EventType.UnitCreateEvent, e => {
    var team = e.unit.team;
    if (team != Vars.player.team()) {
        getTeamAch(team).processUnitCreateEvent(e.unit.type);
    }
});

var anticommandspam = new Seq();

const onChat = function(sender, message) {
    if (message) {
        var all = message.split(" ");
        var cmd = all[0];
        switch (cmd) {
            case "help":
                print("[red]PvP-Alerts [white]commands: [green]enable, disable, wipe, items, units, prefix, turretdmg, ammo");
                break;
            case "enable":
                enabled = true;
                print("[green]PvP-Alerts enabled");
                break;
            case "disable":
                enabled = false;
                print("[red]Disabled PvP-alerts");
                break;
            case "prefix":
                prefix = all[1];
                print("[cyan]Changed prefix to:[white]" + prefix);
                break;
            case "wipe":
                clear();
                break;
            case "items":
                if (teams) {
                    var keys = Object.keys(teams);
                    for (var ki = 0; ki < keys.length; ki++) {
                        var k = teams[keys[ki]].team;
                        var f = "";
                        k.items().each((item, amount) => {
                            f += toBlockEmoji(item) + ":" + amount + ",";
                        });
                        if (f.length == 0) continue;
                        f = "Team " + chatTeamColor(k) + k.name + "[white]'s items:" + f;
                        queue.add(f);
                    }
                    queue.add("[cyan]Scanning enemy core items..");
                }
                break;
            case "glitch":
                glitch = !glitch;
                break;
            case "units":

                var teamUnits = {};
                try {
                    var it = Groups.unit.iterator();
                    var count = 0;
                    while (it.hasNext()) {
                        var unit = it.next();
                        count++;
                        if (!unit || unit.dead) continue;
                        var tid = unit.team.id;
                        if (!teamUnits[tid]) {
                            teamUnits[tid] = { team: unit.team, counts: {} };
                        }
                        var tn = unit.type.name;
                        if (!teamUnits[tid].counts[tn]) {
                            teamUnits[tid].counts[tn] = { type: unit.type, count: 0 };
                        }
                        teamUnits[tid].counts[tn].count++;
                    }

                } catch(err) {
                    print("PvP-Alerts: unit count error: " + err);
                }
                var teamKeys = Object.keys(teamUnits);
                if (teamKeys.length == 0) {
                    queue.add("[white]No units found");
                } else {
                    for (var ti = 0; ti < teamKeys.length; ti++) {
                        var td = teamUnits[teamKeys[ti]];
                        var f = (Vars.player.team() == td.team ? "Your team" : "Team " + chatTeamColor(td.team) + td.team.name + "[white]");
                        var ukeys = Object.keys(td.counts);
                        if (ukeys.length == 0) {
                            f += "[white] has no units currently";
                        } else {
                            var uf = "";
                            for (var ui = 0; ui < ukeys.length; ui++) {
                                var entry = td.counts[ukeys[ui]];
                                uf += toBlockEmoji(entry.type) + ":" + entry.count + ", ";
                            }
                            f += "[white]'s units:" + uf;
                        }
                        queue.add(f);
                    }
                        queue.add("[cyan]Counting enemy units..");
                }
                break;
            case "turretdmg":
                showTurretDmg = !showTurretDmg;
                if (dmgBtnRef) dmgBtnRef.setChecked(showTurretDmg);
                Core.settings.put("pvpnotifs-showturretdmg", showTurretDmg);
                syncAmmoSprites();
                print("[green]PvP-Alerts: ammo shape sprites (triangle/circle) " + (showTurretDmg ? "on" : "off") + " [white]— " + ammoStatus);
                break;
            case "ammo":
                print("[yellow]-- PvP-Alerts ammo diagnostics --");
                print("mod version: [white]" + localModVersion());
                print("toggle: [white]" + showTurretDmg + "[white] | built: " + ammoBuilt + " | applied: " + ammoApplied);
                print("status: [white]" + ammoStatus);
                try {
                    var cnt = Vars.content.bullets().size;
                    print("content bullets: [white]" + cnt);
                } catch (e9) { print("content bullets: [red]error " + e9); }
                break;
            case "debug":
                pvpDebug = !pvpDebug;
                Core.settings.put("pvpnotifs-debug", pvpDebug);
                print("[green]PvP-Alerts: debug messages " + (pvpDebug ? "ON" : "OFF"));
                break;
        }
    }
};

global.alerts.onChat = function(msg) { onChat(Vars.player ? Vars.player.name : "local", msg); };

function rebuildTechSummary(t) {
    t.clear();
    t.add("[gold]Team Tech Summary (live)").row();

    var materialBlocks = [
        {item: Items.graphite, blocks: [Blocks.graphitePress]},
        {item: Items.silicon, blocks: [Blocks.siliconSmelter, Blocks.siliconCrucible, Blocks.siliconArcFurnace]},
        {item: Items.metaglass, blocks: [Blocks.kiln]},
        {item: Items.plastanium, blocks: [Blocks.plastaniumCompressor]},
        {item: Items.phaseFabric, blocks: [Blocks.phaseWeaver, Blocks.phaseSynthesizer]},
        {item: Items.surgeAlloy, blocks: [Blocks.surgeSmelter, Blocks.surgeCrucible]},
        {item: Items.carbide, blocks: [Blocks.carbideCrucible]},
        {item: Items.pyratite, blocks: [Blocks.pyratiteMixer]},
        {item: Items.blastCompound, blocks: [Blocks.blastMixer]}
    ];

    function blk(name) {
        try { return Blocks[name]; } catch (e) { return null; }
    }

    var keyBlockNames = [
        "ripple", "breach", "flame", "cryo", "fuse", "pointDefense",
        "cyclone", "segment", "parallax", "smite", "meltdown",
        "spectre", "titan", "fortress", "foreshadow"
    ];
    var keyBlocks = [];
    for (var kbi = 0; kbi < keyBlockNames.length; kbi++) {
        var kb = blk(keyBlockNames[kbi]);
        if (kb) keyBlocks.push(kb);
    }

    var teamData = {};
    t.clear();

    try {
        var bit = Groups.build.iterator();
        while (bit.hasNext()) {
            var b = bit.next();
            if (!b) continue;
            var team = b.team;
            if (!team || team == Team.derelict) continue;
            var tid = team.id;
            if (!teamData[tid]) {
                teamData[tid] = {team: team, materials: {}, keyBuildings: {}, unitCounts: {}};
            }
            var block = b.block;
            for (var mi = 0; mi < materialBlocks.length; mi++) {
                for (var bi = 0; bi < materialBlocks[mi].blocks.length; bi++) {
                    if (block == materialBlocks[mi].blocks[bi]) {
                        teamData[tid].materials[materialBlocks[mi].item.name] = materialBlocks[mi].item;
                    }
                }
            }
            for (var ki = 0; ki < keyBlocks.length; ki++) {
                if (block == keyBlocks[ki]) {
                    teamData[tid].keyBuildings[block.name] = block;
                }
            }
        }
    } catch (err) {}

    try {
        var it = Groups.unit.iterator();
        while (it.hasNext()) {
            var u = it.next();
            if (!u || u.dead) continue;
            var tid = u.team.id;
            if (!teamData[tid]) {
                teamData[tid] = {team: u.team, materials: {}, keyBuildings: {}, unitCounts: {}};
            }
            var tn = u.type.name;
            if (!teamData[tid].unitCounts[tn]) {
                teamData[tid].unitCounts[tn] = {type: u.type, count: 0};
            }
            teamData[tid].unitCounts[tn].count++;
        }
    } catch(err) {}

    var teamIds = Object.keys(teamData);
    if (teamIds.length == 0) {
        t.add("[gray]No teams detected.");
        return;
    }
    for (var ti = 0; ti < teamIds.length; ti++) {
        var td = teamData[teamIds[ti]];
        var tm = td.team;
        var isPlayer = (tm == Vars.player.team());
        var prefix = isPlayer ? "[white]Your team" : "[#" + tm.color.toString() + "]" + tm.name + "[white]";
        t.add(prefix);
        t.row();

        var matLine = "[gray]Materials: ";
        var matKeys = Object.keys(td.materials);
        if (matKeys.length == 0) {
            matLine += "[darkgray]none";
        } else {
            for (var mi = 0; mi < materialBlocks.length; mi++) {
                var has = td.materials[materialBlocks[mi].item.name] != null;
                matLine += (has ? "[green]+" : "[darkgray]-") + "[white]" + toBlockEmoji(materialBlocks[mi].item);
            }
        }
        t.add(matLine);
        t.row();

        var bLine = "[gray]Buildings: ";
        var bkKeys = Object.keys(td.keyBuildings);
        if (bkKeys.length == 0) {
            bLine += "[darkgray]none";
        } else {
            for (var bi = 0; bi < keyBlocks.length; bi++) {
                var has = td.keyBuildings[keyBlocks[bi].name] != null;
                bLine += (has ? "[green]+" : "[darkgray]-") + "[white]" + toBlockEmoji(keyBlocks[bi]);
            }
        }
        t.add(bLine);
        t.row();

        var uKeys = Object.keys(td.unitCounts);
        if (uKeys.length > 0) {
            var uLine = "[gray]Units: ";
            for (var ui = 0; ui < uKeys.length; ui++) {
                var entry = td.unitCounts[uKeys[ui]];
                uLine += toBlockEmoji(entry.type) + ":" + entry.count + " ";
            }
            t.add(uLine);
            t.row();
        }
    }
}

function showTechSummary() {
    if (techSummaryTable) {
        techSummaryTable.remove();
        techSummaryTable = null;
        return;
    }

    var techSummaryAcc = 0;

    var t = new Table(Tex.button);
    t.margin(12);

    var c = new Table();
    c.background(Styles.black6);
    c.margin(8);
    c.add(t);

    var place = function() {
        c.pack();
        var h = Core.graphics.getHeight();
        var ph = c.getPrefHeight();
        var y = (h - ph) * 0.4;
        if (y + ph > h - 6) y = h - ph - 6;
        if (y < 6) y = 6;
        c.setPosition(6, y);
    };

    c.update(function() {
        if (Vars.state.isMenu()) {
            c.remove();
            techSummaryTable = null;
            return;
        }
        techSummaryAcc += Time.delta;
        if (techSummaryAcc >= 500) {
            techSummaryAcc = 0;
            rebuildTechSummary(t);
            place();
        }
    });

    rebuildTechSummary(t);
    place();
    Vars.ui.hudGroup.addChild(c);
    techSummaryTable = c;
}
function jsonField(json, key) {
    var idx = json.indexOf("\"" + key + "\"");
    if (idx < 0) return null;
    var colon = json.indexOf(":", idx + key.length + 2);
    var q1 = json.indexOf("\"", colon + 1);
    if (q1 < 0) return null;
    var q2 = json.indexOf("\"", q1 + 1);
    if (q2 < 0) return null;
    return json.substring(q1 + 1, q2);
}

function getRepo() { return "Regator48/PvP-Notifs"; }

function getBranch() {
    try {
        var b = Core.settings.getString("pvpnotifs-branch", "").trim();
        if (b.length > 0) return b;
    } catch (e) {}
    return "v159";
}

function isBeta() {
    try {
        return Core.settings.getBool("pvpnotifs-beta", false);
    } catch (e) {}
    return false;
}

function getRawUrl() {
    try {
        var c = Core.settings.getString("pvpnotifs-rawurl", "").trim();
        if (c.length > 0) return c;
    } catch (e) {}
    return "https://raw.githubusercontent.com/" + getRepo() + "/" + getBranch() + "/mod.json";
}

function getZipUrl() {
    try {
        var c = Core.settings.getString("pvpnotifs-zipurl", "").trim();
        if (c.length > 0) return c;
    } catch (e) {}
    return "https://codeload.github.com/" + getRepo() + "/zip/refs/heads/" + getBranch();
}

function getGitee() {
    try {
        var g = Core.settings.getString("pvpnotifs-gitee", "").trim();
        if (g.length > 0) return g;
    } catch (e) {}
    return "";
}

function getGiteeRawUrl() {
    var g = getGitee();
    if (g.length == 0) return "";
    return "https://gitee.com/" + g + "/raw/" + getBranch() + "/mod.json";
}

function getGiteeZipUrl() {
    var g = getGitee();
    if (g.length == 0) return "";
    return "https://gitee.com/" + g + "/repository/archive/" + getBranch() + ".zip";
}

function httpGetFallback(url, fallbackUrl, onResult, onError) {
    Http.get(url).header("User-Agent", "PvP-Notifs").error(function(e) {
        if (fallbackUrl && fallbackUrl.length > 0) {
            Log.warn("Primary update URL failed, trying Gitee mirror: " + fallbackUrl);
            Http.get(fallbackUrl).header("User-Agent", "PvP-Notifs").error(onError).submit(onResult);
        } else {
            onError(e);
        }
    }).submit(onResult);
}

function showVoteEditor() {
    var cur = "";
    try {
        cur = Core.settings.getString("pvpnotifs-vote", "/vote y");
    } catch (e) {}
    var dialog = new BaseDialog("Edit Vote Command");
    dialog.addCloseButton();
    dialog.cont.add("Text sent when Vote button is clicked:").pad(5).row();
    var tf = new TextField(cur);
    tf.setMaxLength(200);
    dialog.cont.add(tf).width(320).row();
    dialog.cont.button("Save", function() {
        Core.settings.put("pvpnotifs-vote", tf.getText());
        dialog.hide();
    }).width(120);
    dialog.cont.button("Reset", function() {
        Core.settings.put("pvpnotifs-vote", "/vote y");
        dialog.hide();
    }).width(120).color(Color.gray);
    dialog.show();
}

function showUpdateConfig() {
    var d = new BaseDialog("Update Settings");
    d.addCloseButton();

    d.cont.add("[gray]Choose the branch you want to track for updates.").pad(5).row();

    var branch = getBranch();
    var branchField = new TextField(branch);
    branchField.setMaxLength(40);
    d.cont.add("Branch: ").left().padRight(8);
    d.cont.add(branchField).width(200).row();

    var beta = isBeta();
    var stableBtn, betaBtn;
    var rebuild = function() {
        stableBtn.setColor(beta ? Color.gray : Color.green);
        betaBtn.setColor(beta ? Color.green : Color.gray);
    };
    d.cont.add("Track:").left().padTop(8).row();
    stableBtn = d.cont.button("Stable (release)", function() {
        beta = false;
        rebuild();
    }).width(150).color(Color.green).get();
    betaBtn = d.cont.button("Beta (pre-releases)", function() {
        beta = true;
        rebuild();
    }).width(200).color(Color.gray).get();
    d.cont.row();
    rebuild();

    d.cont.add("[gray]Stable downloads the newest release marked stable.").padTop(8).row();
    d.cont.add("[gray]Beta also includes pre-release builds (fresh pushes, before testing).").row();

    var rawField = new TextField(getRawUrl());
    rawField.setMaxLength(500);
    d.cont.add("mod.json URL (mirror for GFW):").padTop(8).row();
    d.cont.add(rawField).width(440).row();

    var zipField = new TextField(getZipUrl());
    zipField.setMaxLength(500);
    d.cont.add("Zip URL (beta download, mirror):").padTop(4).row();
    d.cont.add(zipField).width(440).row();

    var giteeField = new TextField(getGitee());
    giteeField.setMaxLength(80);
    d.cont.add("[gray]Gitee repo (optional, auto-fallback if GitHub is blocked):").padTop(8).row();
    d.cont.add("e.g. Regator48/PvP-Notifs  ->  [white]leave empty if unused").row();
    d.cont.add(giteeField).width(440).row();

    d.cont.button("Save", function() {
        Core.settings.put("pvpnotifs-branch", branchField.getText().trim());
        Core.settings.put("pvpnotifs-beta", beta);
        Core.settings.put("pvpnotifs-rawurl", rawField.getText().trim());
        Core.settings.put("pvpnotifs-zipurl", zipField.getText().trim());
        Core.settings.put("pvpnotifs-gitee", giteeField.getText().trim());
        // clear legacy keys from the old commit-SHA updater
        Core.settings.put("pvpnotifs-commitsurl", "");
        Core.settings.put("pvpnotifs-lastsha", "");
        d.hide();
        checkForUpdates();
    }).width(120);
    d.cont.button("Reset", function() {
        Core.settings.put("pvpnotifs-branch", "v159");
        Core.settings.put("pvpnotifs-beta", false);
        Core.settings.put("pvpnotifs-rawurl", "");
        Core.settings.put("pvpnotifs-commitsurl", "");
        Core.settings.put("pvpnotifs-zipurl", "");
        Core.settings.put("pvpnotifs-gitee", "");
        d.hide();
    }).width(120).color(Color.gray);
    d.show();
}

function zipModName(fi, fieldName) {
    try {
        var key = fieldName || "name";
        var bytes = fi.readBytes();
        var zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes));
        var buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
        var entry;
        while ((entry = zis.getNextEntry()) != null) {
            var n = entry.getName();
            if (n == "mod.json" || n.endsWith("/mod.json")) {
                var baos = new java.io.ByteArrayOutputStream();
                var len;
                while ((len = zis.read(buf)) > 0) baos.write(buf, 0, len);
                zis.closeEntry();
                zis.close();
                return jsonField(new java.lang.String(baos.toByteArray(), "UTF-8"), key);
            }
            zis.closeEntry();
        }
        zis.close();
    } catch (e) {}
    return null;
}

// Reads the installed mod's version robustly: Mods API -> mod.json on disk.
function localModVersion() {
    var v = "";
    try {
        var m = Vars.mods.getMod("PvP-Alerts");
        if (m) {
            try { if (m.meta && m.meta.version) v = "" + m.meta.version; } catch (e1) {}
            if (!v) { try { if (m.version) v = "" + m.version; } catch (e2) {} }
        }
    } catch (e) {}
    if (!v) {
        try {
            var f = findModFile();
            if (f && f.exists()) {
                if (f.isDirectory()) {
                    var mj = f.child("mod.json");
                    if (mj.exists()) v = jsonField(mj.readString(), "version") || "";
                } else {
                    v = zipModName(f, "version") || "";
                }
            }
        } catch (e3) {}
    }
    return v || "0.0.0";
}

function findModFile() {
    try {
        var m0 = Vars.mods.getMod("PvP-Alerts");
        if (m0 && m0.file && m0.file.exists()) return m0.file;
    } catch (e0) {}

    try {
        var list = null;
        try { list = Vars.mods.orderedItems(); } catch (e1) {}
        if (list == null) { try { list = Vars.mods.all; } catch (e2) {} }
        if (list != null) {
            for (var i = 0; i < list.size; i++) {
                var m = list.get(i);
                if (!m) continue;
                var nm = (m.name != null) ? ("" + m.name).toLowerCase() : "";
                if (nm.indexOf("pvp") >= 0 && m.file && m.file.exists()) return m.file;
            }
        }
    } catch (e) {}

    try {
        var dir = new java.io.File(Vars.modDirectory.path());
        var files = dir.listFiles();
        if (files != null) {
            for (var j = 0; j < files.length; j++) {
                var f = files[j];
                if (!f) continue;
                var fname = ("" + f.getName()).toLowerCase();
                if (fname.indexOf("pvp") >= 0) return Vars.modDirectory.child(f.getName());
            }
            for (var j2 = 0; j2 < files.length; j2++) {
                var f2 = files[j2];
                if (!f2) continue;
                var fi = Vars.modDirectory.child(f2.getName());
                var nm2 = null;
                if (f2.isDirectory()) {
                    var mj = fi.child("mod.json");
                    if (mj.exists()) nm2 = jsonField(mj.readString(), "name");
                } else {
                    nm2 = zipModName(fi);
                }
                if (nm2 && ("" + nm2).toLowerCase().indexOf("pvp") >= 0) return fi;
            }
        }
    } catch (e3) {}
    return null;
}

function downloadAndReplace(zipUrlOverride) {
    var zipUrl = zipUrlOverride || getZipUrl();
    Vars.ui.showInfoToast("Downloading update (" + getBranch() + ") ...", 4);
    httpGetFallback(zipUrl, getGiteeZipUrl(), function(response) {
        try {
            var bytes = response.getResult();
            var modFile = findModFile();
            if (!modFile || !modFile.exists()) {
                var diag = "modsDir=";
                try { diag += (Vars.modDirectory != null ? Vars.modDirectory.path() : "null"); } catch (e) { diag += "err:" + e; }
                diag += " | children=";
                try {
                    var dir = new java.io.File(Vars.modDirectory.path());
                    var fls = dir.listFiles();
                    if (fls != null) {
                        for (var di = 0; di < fls.length; di++) {
                            diag += (di > 0 ? ", " : "") + fls[di].getName() + (fls[di].isDirectory() ? "(dir)" : "(file)");
                        }
                    }
                } catch (e2) { diag += "err:" + e2; }
                diag += " | loadedMods=";
                try {
                    var all = null;
                    try { all = Vars.mods.orderedItems(); } catch (e4) {}
                    if (all == null) { try { all = Vars.mods.all; } catch (e5) {} }
                    if (all != null) {
                        for (var li = 0; li < all.size; li++) {
                            var mm = all.get(li);
                            diag += (li > 0 ? ", " : "") + (mm.name != null ? mm.name : "?") + (mm.file != null ? "@" + mm.file.name() : "@null");
                        }
                    } else {
                        diag += "unavailable";
                    }
                } catch (e3) { diag += "err:" + e3; }
                throw new Error("Cannot locate mod file for PvP-Alerts\n[" + diag + "]");
            }
            if (modFile.isDirectory()) {
                var zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes));
                var entry;
                var topLen = -1;
                while ((entry = zis.getNextEntry()) != null) {
                    var name = entry.getName();
                    if (topLen < 0) {
                        var slash = name.indexOf("/");
                        topLen = (slash >= 0) ? slash + 1 : 0;
                    }
                    var rel = name.substring(topLen);
                    zis.closeEntry();
                    if (rel.length == 0) continue;
                    var out = modFile.child(rel);
                    if (entry.isDirectory()) {
                        out.mkdirs();
                    } else {
                        if (out.parent() != null) out.parent().mkdirs();
                        var os = out.write(false);
                        arc.util.io.Streams.copy(zis, os);
                        os.close();
                    }
                }
                zis.close();
            } else {
                var baos = new java.io.ByteArrayOutputStream();
                var zos = new java.util.zip.ZipOutputStream(baos);
                var zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes));
                var buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
                var entry;
                var topLen = -1;
                while ((entry = zis.getNextEntry()) != null) {
                    var name = entry.getName();
                    if (topLen < 0) {
                        var slash = name.indexOf("/");
                        topLen = (slash >= 0) ? slash + 1 : 0;
                    }
                    var rel = name.substring(topLen);
                    if (rel.length == 0 || entry.isDirectory()) {
                        zis.closeEntry();
                        continue;
                    }
                    zos.putNextEntry(new java.util.zip.ZipEntry(rel));
                    var len;
                    while ((len = zis.read(buf)) > 0) {
                        zos.write(buf, 0, len);
                    }
                    zos.closeEntry();
                    zis.closeEntry();
                }
                zis.close();
                zos.close();
                modFile.writeBytes(baos.toByteArray());
            }
            // Show restart dialog instead of just a toast
            Core.app.post(function() {
                var d = new BaseDialog("Update Applied");
                d.cont.add("[green]Update applied successfully!").pad(10).row();
                d.cont.add("[gray]Close and reopen Mindustry to load the new version.").pad(5).row();
                d.cont.button("Exit Game", function() {
                    d.hide();
                    Core.app.exit();
                }).width(180).color(Color.orange);
                d.cont.button("Later", function() {
                    d.hide();
                }).width(120).color(Color.gray);
                d.show();
            });
        } catch (err) {
            Log.err("Update extract failed", err);
            Vars.ui.showErrorMessage("Extract failed: " + err);
        }
    }, function(e) {
        Log.err("Update download failed", e);
        Vars.ui.showErrorMessage("Download failed: " + ((e && e.getMessage) ? e.getMessage() : e));
    });
}

function semverTuple(v) {
    try {
        var m = ("" + v).trim().replace(/^v/i, "").match(/(\d+)\.(\d+)\.(\d+)/);
        if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    } catch (e) {}
    return null;
}

function isNewerVersion(remote, local) {
    var r = semverTuple(remote), l = semverTuple(local);
    if (r && l) {
        if (r[0] != l[0]) return r[0] > l[0];
        if (r[1] != l[1]) return r[1] > l[1];
        if (r[2] != l[2]) return r[2] > l[2];
        return false;
    }
    return ("" + remote) !== ("" + local);
}

function checkForUpdates() {
    var currentVersion = localModVersion();

    var repo = getRepo();
    var beta = isBeta();

    // Primary: GitHub Releases API.
    // Stable channel = newest non-prerelease release. Beta channel = newest build of any kind.
    // Downloads the release's PvP-Alerts-*.zip asset directly in-game.
    var releasesUrl = "https://api.github.com/repos/" + repo + "/releases?per_page=30";
    httpGetFallback(releasesUrl, "", function(response) {
        try {
            var arr = JSON.parse(response.getResultAsString());
            if (!arr || arr.length === undefined) throw new Error("unexpected releases payload");
            var pick = null;
            for (var i = 0; i < arr.length; i++) {
                var r = arr[i];
                if (!r || r.draft) continue;
                if (beta || !r.prerelease) { pick = r; break; }
            }
            Core.app.post(function() {
                var d = new BaseDialog(beta ? "Beta Update Check" : "Update Check");
                d.addCloseButton();
                d.cont.add("Channel: [white]" + (beta ? "beta (pre-releases)" : "stable")).pad(5).row();
                d.cont.add("Installed: [white]v" + currentVersion).pad(5).row();
                var offered = false;
                if (pick == null) {
                    d.cont.add("[red]No matching release found.").pad(5).row();
                    d.cont.button("Open Releases", function() {
                        Core.app.openURI("https://github.com/" + repo + "/releases");
                        d.hide();
                    }).width(160).color(Color.green);
                } else {
                    var tag = "" + (pick.tag_name || "");
                    var latestV = tag.replace(/^v/i, "");
                    var assetUrl = null;
                    try {
                        var assets = pick.assets || [];
                        for (var a = 0; a < assets.length; a++) {
                            var an = "" + assets[a].name;
                            if (/^PvP-Alerts.*\.zip$/i.test(an)) { assetUrl = assets[a].browser_download_url; break; }
                        }
                    } catch (e2) {}
                    d.cont.add("Latest " + (beta ? "build" : "stable") + ": [white]" + tag + (pick.prerelease ? " [orange](beta)" : "")).pad(5).row();
                    if (isNewerVersion(latestV, currentVersion)) {
                        if (assetUrl != null) {
                            d.cont.add("[yellow]Update available.").pad(5).row();
                            d.cont.button("Download & Replace", function() {
                                d.hide();
                                downloadAndReplace(assetUrl);
                            }).width(180).color(Color.green);
                            offered = true;
                        } else {
                            d.cont.add("[yellow]Update available, but the release has no PvP-Alerts-*.zip asset.").pad(5).row();
                        }
                    } else {
                        d.cont.add("You have the latest " + (beta ? "beta build." : "version."));
                        d.cont.row();
                    }
                }
                d.cont.button("Skip", function() { d.hide(); }).width(100).color(Color.gray);
                d.show();
            });
        } catch (err) {
            Log.err("Releases parse failed", err);
            Vars.ui.showErrorMessage("Could not read releases info.");
        }
    }, function(e3) {
        // Fallback when the GitHub API is unreachable (e.g. GFW): raw mod.json compare + browser.
        Log.warn("Releases API failed, falling back to raw version check", e3);
        httpGetFallback(getRawUrl(), getGiteeRawUrl(), function(response) {
            var latestVersion = jsonField(response.getResultAsString(), "version");
            Core.app.post(function() {
                var dialog = new BaseDialog("Update Check");
                dialog.addCloseButton();
                dialog.cont.add("[gray]Releases API unreachable — basic mode.").pad(5).row();
                dialog.cont.add("PvP-Notifs v" + currentVersion).pad(10).row();
                if (latestVersion != null) {
                    dialog.cont.add("Latest: v" + latestVersion).pad(10).row();
                    if (isNewerVersion(latestVersion, currentVersion)) {
                        dialog.cont.add("An update is available!").pad(10).row();
                        dialog.cont.button("Open Releases", function() {
                            Core.app.openURI("https://github.com/" + repo + "/releases");
                            dialog.hide();
                        }).width(150).color(Color.green);
                    } else {
                        dialog.cont.add("You have the latest version.").pad(10).row();
                    }
                } else {
                    dialog.cont.add("Could not read version info.").pad(10).row();
                }
                dialog.show();
            });
        }, function(e) {
            Log.warn("Update check failed", e);
            Vars.ui.showErrorMessage("Update check failed: " + ((e && e.getMessage) ? e.getMessage() : e));
        });
    });
}
