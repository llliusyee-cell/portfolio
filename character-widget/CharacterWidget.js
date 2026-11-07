/*!
 * CharacterWidget v1.0
 * Five-layer character eye rig: eye-white → irises → eye-shadow → clean character → blink frames.
 * No dependencies. Scoped CSS. Original V30 art preserved.
 */
(function (global) {
  'use strict';

  var IMG_W = 2730;
  var IMG_H = 1536;
  var REF_W = 2048;          // V30 reference coordinate width
  var K = IMG_W / REF_W;     // 2048-space px → 2730-space px

  var DEFAULTS = {
    autoBlink: true,
    gazeTracking: true,
    idleGaze: true,
    blinkSpeed: 15,
    doubleBlinkChance: 0.15,
    maxX: 7,                 // V30 reference px
    maxY: 5,
    idleX: 1.05,
    idleY: 0.6,
    smoothing: 120,          // ms
    interval: 6000,          // upper bound of random blink interval (ms)
    video: null,
    trackRoot: null,
    clickToBlink: true,
    respectReducedMotion: true
  };

  var SEQUENCE = [1, 2, 3, 4, 3, 2, 1, 0];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function now() { return global.performance && global.performance.now ? global.performance.now() : Date.now(); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function resolveEl(v) {
    if (!v) return null;
    return typeof v === 'string' ? document.querySelector(v) : v;
  }

  function CharacterWidget(root, options) {
    if (!root) throw new Error('CharacterWidget: root element is required');
    if (root.__cw) return root.__cw;

    this.root = root;
    this.opts = Object.assign({}, DEFAULTS, options || {});
    this.layers = {
      white: root.querySelector('[data-cw="white"]'),
      left: root.querySelector('[data-cw="iris-left"]'),
      right: root.querySelector('[data-cw="iris-right"]'),
      shadow: root.querySelector('[data-cw="shadow"]'),
      character: root.querySelector('[data-cw="character"]')
    };
    this.blinkEls = [1, 2, 3, 4].map(function (i) {
      return root.querySelector('[data-cw="blink-' + i + '"]');
    });

    if (!this.layers.character || !this.layers.left || !this.layers.right) {
      if (global.console && console.warn) console.warn('CharacterWidget: eye layers missing');
      return;
    }

    this.video = resolveEl(this.opts.video);
    this.trackRoot = resolveEl(this.opts.trackRoot) || root.closest('section') || root.parentElement || root;

    this.current = 0;
    this.blinking = false;
    this.paused = false;
    this.destroyed = false;
    this.videoActive = false;
    this.visible = true;
    this.generation = 0;
    this.autoTimer = null;
    this.raf = null;
    this.scale = 0;

    this.targetX = 0; this.targetY = 0;
    this.posX = 0; this.posY = 0;
    this.idleX = 0; this.idleY = 0;
    this.lastPointerTime = now();
    this.nextIdleTime = this.lastPointerTime + 2600;
    this.lastFrameTime = now();

    this.reduceMotion = !!(this.opts.respectReducedMotion &&
      global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);

    this._bind();
    this.measure();
    this.showFrame(0);
    root.__cw = this;

    if (this.video && !this.video.paused && !this.video.ended) {
      this.setVideoActive(true);
    } else {
      this.resume();
    }
  }

  CharacterWidget.prototype._bind = function () {
    var t = this.trackRoot;
    t.addEventListener('pointermove', this._onPointerMove, { passive: true });
    t.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    t.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
    t.addEventListener('click', this._onClick);

    document.addEventListener('visibilitychange', this._onVisibility);

    if (this.video) {
      var self = this;
      this._onVideoPlay = function () { self.setVideoActive(true); };
      this._onVideoEnded = function () { self.setVideoActive(false); };
      this._onVideoError = function () { self.setVideoActive(false); };
      this.video.addEventListener('play', this._onVideoPlay);
      this.video.addEventListener('playing', this._onVideoPlay);
      this.video.addEventListener('ended', this._onVideoEnded);
      this.video.addEventListener('error', this._onVideoError);
    }

    if (global.IntersectionObserver) {
      var me = this;
      this.io = new IntersectionObserver(function (entries) {
        var e = entries[0];
        me.visible = !!(e && e.isIntersecting);
        if (!me.visible) me.pause();
        else if (!me.videoActive) me.resume();
      }, { threshold: 0.01 });
      this.io.observe(this.root);
    }

    if (global.ResizeObserver) {
      var self2 = this;
      this.ro = new ResizeObserver(function () { self2.measure(); });
      this.ro.observe(this.root);
    } else {
      var self3 = this;
      this._onResize = function () { self3.measure(); };
      global.addEventListener('resize', this._onResize);
    }
  };

  CharacterWidget.prototype.measure = function () {
    if (this.destroyed) return;
    var r = this.root.getBoundingClientRect();
    var prev = this.scale;
    this.scale = (r.width && r.height) ? Math.max(r.width / IMG_W, r.height / IMG_H) : 0;
    if (this.scale !== prev) this.apply();
  };

  CharacterWidget.prototype.apply = function () {
    if (!this.scale) return;
    var x = (this.posX * this.scale).toFixed(3);
    var y = (this.posY * this.scale).toFixed(3);
    var tr = 'translate3d(' + x + 'px,' + y + 'px,0)';
    if (this.layers.left) this.layers.left.style.transform = tr;
    if (this.layers.right) this.layers.right.style.transform = tr;
  };

  CharacterWidget.prototype.showFrame = function (i) {
    this.current = i;
    for (var k = 0; k < this.blinkEls.length; k++) {
      var el = this.blinkEls[k];
      if (el) el.hidden = (k + 1 !== i);
    }
  };

  CharacterWidget.prototype._onPointerMove = function (e) {
    if (!this.opts.gazeTracking || this.paused || this.videoActive) return;
    if (e.pointerType === 'touch' && !e.buttons) return;
    this._track(e.clientX, e.clientY);
  };

  CharacterWidget.prototype._onPointerDown = function (e) {
    if (e.pointerType !== 'touch') return;
    this._track(e.clientX, e.clientY);
  };

  CharacterWidget.prototype._track = function (clientX, clientY) {
    if (!this.opts.gazeTracking || this.paused || this.videoActive) return;
    var r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var nx = clamp((clientX - r.left) / r.width, 0, 1);
    var ny = clamp((clientY - r.top) / r.height, 0, 1);
    this.targetX = (nx * 2 - 1) * this.opts.maxX * K;
    this.targetY = (ny * 2 - 1) * this.opts.maxY * K;
    this.lastPointerTime = now();
    this.nextIdleTime = this.lastPointerTime + 2400;
    this.idleX = this.idleY = 0;
  };

  CharacterWidget.prototype._onPointerLeave = function () {
    this.targetX = 0;
    this.targetY = 0;
    this.lastPointerTime = now();
    this.nextIdleTime = this.lastPointerTime + 2400;
    this.idleX = this.idleY = 0;
  };

  CharacterWidget.prototype._onClick = function (e) {
    if (!this.opts.clickToBlink || this.paused || this.videoActive) return;
    var t = e.target;
    if (t && t.closest && t.closest('a,button,input,label,select,textarea,[role="button"]')) return;
    this.blink(false);
  };

  CharacterWidget.prototype._onVisibility = function () {
    if (document.hidden) this.pause();
    else if (this.visible && !this.videoActive) this.resume();
  };

  CharacterWidget.prototype._tick = function (dt, t) {
    var o = this.opts;
    var gaze = o.gazeTracking;
    var idleAllowed = o.idleGaze && !this.reduceMotion;

    if (gaze && idleAllowed && !this.blinking && !document.hidden &&
        t >= this.nextIdleTime && t - this.lastPointerTime > 2200) {
      this.idleX = (Math.random() * 2 - 1) * o.idleX * K;
      this.idleY = (Math.random() * 2 - 1) * o.idleY * K;
      this.nextIdleTime = t + 1450 + Math.random() * 2300;
    } else if ((!gaze || !idleAllowed || t - this.lastPointerTime < 2200) &&
               (this.idleX !== 0 || this.idleY !== 0)) {
      this.idleX = this.idleY = 0;
    }

    var maxX = o.maxX * K;
    var maxY = o.maxY * K;
    var tx = gaze ? clamp(this.targetX + this.idleX, -maxX, maxX) : 0;
    var ty = gaze ? clamp(this.targetY + this.idleY, -maxY, maxY) : 0;

    if (!this.blinking && this.current === 0) {
      var tau = Math.max(1, o.smoothing);
      var f = 1 - Math.exp(-dt / tau);
      this.posX += (tx - this.posX) * f;
      this.posY += (ty - this.posY) * f;
      if (Math.abs(this.posX - tx) < 0.001) this.posX = tx;
      if (Math.abs(this.posY - ty) < 0.001) this.posY = ty;
    }
    this.apply();
  };

  CharacterWidget.prototype._loop = function (t) {
    this.raf = null;
    if (this.paused || this.destroyed) return;
    var dt = clamp(t - this.lastFrameTime, 0, 50);
    this.lastFrameTime = t;
    this._tick(dt, t);
    var self = this;
    this.raf = requestAnimationFrame(function (ts) { self._loop(ts); });
  };

  CharacterWidget.prototype.resume = function () {
    if (this.destroyed || this.videoActive) return;
    this.paused = false;
    this.lastFrameTime = now();
    if (!this.raf) {
      var self = this;
      this.raf = requestAnimationFrame(function (t) { self._loop(t); });
    }
    this.schedule();
  };

  CharacterWidget.prototype.pause = function () {
    if (this.destroyed) return;
    this.paused = true;
    this.generation++;
    this.blinking = false;
    this.clearAuto();
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    this.posX = this.posY = 0;
    this.targetX = this.targetY = 0;
    this.idleX = this.idleY = 0;
    this.apply();
    this.showFrame(0);
  };

  CharacterWidget.prototype.setVideoActive = function (active) {
    if (this.destroyed) return;
    if (this.videoActive === active) return;
    this.videoActive = active;
    if (active) this.pause();
    else this.resume();
  };

  CharacterWidget.prototype.clearAuto = function () {
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
  };

  CharacterWidget.prototype.schedule = function () {
    this.clearAuto();
    var o = this.opts;
    if (!o.autoBlink || this.reduceMotion || this.paused || this.videoActive ||
        this.blinking || !this.visible || document.hidden) return;
    var upper = Math.max(2800, o.interval);
    var delay = 2800 + Math.random() * Math.max(0, upper - 2800);
    var self = this;
    this.autoTimer = setTimeout(function () {
      self.autoTimer = null;
      if (self.paused || self.videoActive || self.blinking || document.hidden) {
        self.schedule();
        return;
      }
      self.blink(Math.random() < o.doubleBlinkChance);
    }, delay);
  };

  CharacterWidget.prototype.blink = function (twice) {
    if (this.destroyed || this.paused || this.videoActive || this.blinking) return;
    var token = ++this.generation;
    this.blinking = true;
    this.clearAuto();
    var self = this;
    var speed = Math.max(1, Number(this.opts.blinkSpeed) || 15);
    var rounds = twice ? 2 : 1;

    (async function () {
      for (var r = 0; r < rounds; r++) {
        for (var i = 0; i < SEQUENCE.length; i++) {
          if (token !== self.generation) return;
          var f = SEQUENCE[i];
          self.showFrame(f);
          await wait(f === 4 ? 50 : speed);
        }
        if (r === 0 && twice) {
          await wait(130);
          if (token !== self.generation) return;
        }
      }
      if (token !== self.generation) return;
      self.blinking = false;
      self.showFrame(0);
      self.schedule();
    })();
  };

  CharacterWidget.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.clearAuto();
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    if (this.io) { this.io.disconnect(); this.io = null; }
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this._onResize) global.removeEventListener('resize', this._onResize);

    var t = this.trackRoot;
    t.removeEventListener('pointermove', this._onPointerMove);
    t.removeEventListener('pointerdown', this._onPointerDown);
    t.removeEventListener('pointerleave', this._onPointerLeave);
    t.removeEventListener('click', this._onClick);
    document.removeEventListener('visibilitychange', this._onVisibility);

    if (this.video) {
      this.video.removeEventListener('play', this._onVideoPlay);
      this.video.removeEventListener('playing', this._onVideoPlay);
      this.video.removeEventListener('ended', this._onVideoEnded);
      this.video.removeEventListener('error', this._onVideoError);
    }
    this.root.__cw = null;
  };

  CharacterWidget.initAll = function () {
    var nodes = document.querySelectorAll('[data-character-widget]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__cw) continue;
      new CharacterWidget(el, {
        video: el.getAttribute('data-cw-video') || null,
        trackRoot: el.getAttribute('data-cw-track') || null
      });
    }
  };

  global.CharacterWidget = CharacterWidget;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', CharacterWidget.initAll);
  } else {
    CharacterWidget.initAll();
  }
})(window);
