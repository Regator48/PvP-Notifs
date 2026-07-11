const jot = require("jotfunction");

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
        var max = 0.5;
        if (tile.build.block.category == Category.distribution) {
            severe *= 1;
        }
        if (tile.build.block.category == Category.defense) {
            severe *= 5 * tile.build.block.size;
            max = 1.5;
        }
        if (tile.build.block.category == Category.turret) {
            severe *= 10 * tile.build.block.size;
            max = 2.5;
        }
        if (tile.build.block.category == Category.power) {
            max = tile.build.block.size * 2;
            if (tile.build.block instanceof PowerGenerator) {
                severe *= 150;
            } else if (tile.build.block instanceof PowerNode) {
                severe *= 3;
            } else {
                severe *= 50;
            }
        }
        if (tile.build.block.category == Category.logic) {
            severe *= 10;
        }
        if (tile.build.block.category == Category.production) {
            severe *= (tile.build.block.size == 2 ? 3 : 30);
            max = tile.build.block.size * 2;
        }
        if (tile.build.block.category == Category.crafting) {
            severe *= 30;
            max = tile.build.block.size * 2;
        }
        if (tile.build.block.category == Category.units) {
            severe *= 200;
            max = 5;
        }
        if (tile.build.block.category == Category.effect) {
            severe *= 5;
            max = 1;
        }
        triggerPip(tile.getX(), tile.getY(), severe, max);
    }
}));

Events.on(EventType.ClientLoadEvent,
    cons(e => {
        alerticonlow = Core.atlas.find("pvpnotifs-alert-0");
        alerticonhigh = Core.atlas.find("pvpnotifs-alert-1");
        pipicon = Core.atlas.find("pvpnotifs-pip");

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

        t.button(Icon.eyeSmall, style, run(() => {
            Vars.enableLight = !Vars.enableLight;
        })).update(b => b.setChecked(Vars.enableLight)).width(46).height(46).name("light").tooltip("toggle lighting");

        t.button(Icon.refresh, style, run(() => {
            Call.sendChatMessage("/sync");
        })).width(46).height(46).name("sync").tooltip("/sync");

        t.button(Icon.hammer, style, run(() => {
            Call.sendChatMessage("/vote y");
        })).width(46).height(46).name("votekick").tooltip("vote y");

        t.button(Icon.units, style, run(() => {
            showTechSummary();
        })).width(46).height(46).name("techsummary").tooltip("enemy tech summary");

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


Events.run(Trigger.drawOver, () => {
    jot.drawMouse();

    Draw.draw(Layer.overlayUI + 0.01, run(() => {
        pips.each(t => {
            t.draw();
        });
    }));
});

var glitch = false;
var delayglitch = 0;

Events.run(Trigger.update, () => {
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
                print("[red]PvP-Alerts [white]commands: [green]enable, disable, wipe, items, units, prefix");
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
        }
    }
};

global.alerts.onChat = function(msg) { onChat(Vars.player ? Vars.player.name : "local", msg); };

function showTechSummary() {
    if (techSummaryTimer) { techSummaryTimer.cancel(); techSummaryTimer = null; }
    if (techSummaryTable) {
        techSummaryTable.remove();
        techSummaryTable = null;
    }

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

    var keyBlocks = [
        Blocks.foreshadow,
        Blocks.spectre,
        Blocks.meltdown,
        Blocks.cyclone,
        Blocks.fuse
    ];

    var teamData = {};

    Vars.world.tiles.each(function(x, y) {
        var tile = Vars.world.tiles.getn(x, y);
        if (!tile || !tile.build) return;
        var team = tile.team();
        if (!team || team == Team.derelict) return;
        var tid = team.id;
        if (!teamData[tid]) {
            teamData[tid] = {team: team, materials: {}, keyBuildings: {}, unitCounts: {}};
        }
        var block = tile.build.block;
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
    });

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

    var t = new Table(Tex.button);
    t.update(function() { if (Vars.state.isMenu()) { if (techSummaryTimer) { techSummaryTimer.cancel(); techSummaryTimer = null; } t.remove(); techSummaryTable = null; } });
    t.margin(12);
    t.add("[gold]Team Tech Summary");
    t.row();

    var teamIds = Object.keys(teamData);
    if (teamIds.length == 0) {
        t.add("[gray]No teams detected.");
    } else {
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
    t.pack();
    var c = Core.scene.table();
    c.margin(10);
    c.add(t);
    c.pack();
    c.setPosition(4, (Core.graphics.getHeight() - c.getPrefHeight()) / 2);
    techSummaryTable = c;

    techSummaryTimer = Timer.schedule(java.lang.Runnable({
        run: function() {
            if (techSummaryTable) {
                techSummaryTable.remove();
                techSummaryTable = null;
            }
            techSummaryTimer = null;
        }
    }), 4);
}
