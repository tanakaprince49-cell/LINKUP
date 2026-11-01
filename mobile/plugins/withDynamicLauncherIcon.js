const {
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const VARIANTS = [
  { id: 'default', alias: 'LauncherDefault', iosName: null, asset: 'icon-padded.png', enabled: true },
  { id: 'angry_1d', alias: 'LauncherAngry1d', iosName: 'Angry1d', asset: 'icon-angry-red.png', enabled: false },
  { id: 'sad_inactive', alias: 'LauncherSadInactive', iosName: 'SadInactive', asset: 'icon-sad-inactive.png', enabled: false },
  { id: 'ghost_abandoned', alias: 'LauncherGhostAbandoned', iosName: 'GhostAbandoned', asset: 'icon-ghost-abandoned.png', enabled: false },
  { id: 'unread_urgent', alias: 'LauncherUnreadUrgent', iosName: 'UnreadUrgent', asset: 'icon-unread-urgent.png', enabled: false },
  { id: 'streak_fire', alias: 'LauncherStreakFire', iosName: 'StreakFire', asset: 'icon-streak-fire.png', enabled: false },
  { id: 'champion_crown', alias: 'LauncherChampionCrown', iosName: 'ChampionCrown', asset: 'icon-champion-crown.png', enabled: false },
  { id: 'on_fire_shipped', alias: 'LauncherOnFireShipped', iosName: 'OnFireShipped', asset: 'icon-shipped.png', enabled: false },
  { id: 'milestone_party', alias: 'LauncherMilestoneParty', iosName: 'MilestoneParty', asset: 'icon-milestone-party.png', enabled: false },
  { id: 'night_owl', alias: 'LauncherNightOwl', iosName: 'NightOwl', asset: 'icon-night-owl.png', enabled: false },
  { id: 'weekend_chill', alias: 'LauncherWeekendChill', iosName: 'WeekendChill', asset: 'icon-weekend-chill.png', enabled: false },
];

const resName = (id) => `ic_launcher_variant_${id}`;

function withAndroidDynamicIcons(config) {
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) return mod;
    const pkg = mod.android?.package || 'com.tana.linkup';

    // Remove LAUNCHER category from MainActivity so only the active activity-alias shows in launcher
    const activities = app.activity || [];
    for (const act of activities) {
      const name = act.$?.['android:name'] || '';
      if (name === '.MainActivity' || name.endsWith('.MainActivity')) {
        for (const filter of act['intent-filter'] || []) {
          if (Array.isArray(filter.category)) {
            filter.category = filter.category.filter(
              (c) => c.$?.['android:name'] !== 'android.intent.category.LAUNCHER',
            );
          }
        }
      }
    }

    const existing = (app['activity-alias'] || []).filter(
      (a) => !VARIANTS.some((v) => a.$?.['android:name'] === `${pkg}.${v.alias}` || a.$?.['android:name'] === `.${v.alias}`),
    );

    const aliases = VARIANTS.map((v) => ({
      $: {
        'android:name': `${pkg}.${v.alias}`,
        'android:enabled': v.enabled ? 'true' : 'false',
        'android:exported': 'true',
        'android:icon': `@mipmap/${resName(v.id)}`,
        'android:roundIcon': `@mipmap/${resName(v.id)}`,
        'android:label': '@string/app_name',
        'android:targetActivity': '.MainActivity',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        },
      ],
    }));

    app['activity-alias'] = [...existing, ...aliases];

    // Internal BroadcastReceiver for 1-day (angry_1d), 3-day (sad_inactive), and 7-day (ghost_abandoned)
    // automatic home-screen launcher decay when the user has not opened LINKUP.
    const receiverClass = `${pkg}.dynamicicon.LinkupIconDecayReceiver`;
    const receivers = (app.receiver || []).filter((r) => r.$?.['android:name'] !== receiverClass);
    receivers.push({
      $: {
        'android:name': receiverClass,
        'android:enabled': 'true',
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }],
        },
      ],
    });
    app.receiver = receivers;

    return mod;
  });

  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const platformRoot = mod.modRequest.platformProjectRoot;
      const pkg = (mod.android?.package || 'com.tana.linkup').replace(/\./g, '/');

      // 1. Copy bundled PNGs into mipmap-xxhdpi & raw keep rules so R8 shrinkResources preserves all 11 icons
      const mipmapDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'mipmap-xxhdpi');
      const rawDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(mipmapDir, { recursive: true });
      fs.mkdirSync(rawDir, { recursive: true });

      for (const v of VARIANTS) {
        const src = path.join(projectRoot, 'assets', v.asset);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(mipmapDir, `${resName(v.id)}.png`));
        }
      }

      const keepTargets = VARIANTS.map((v) => `@mipmap/${resName(v.id)}`).join(',');
      fs.writeFileSync(
        path.join(rawDir, 'keep_dynamic_icons.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="${keepTargets}" />\n`,
      );

      // 2. Write Kotlin native module + lifecycle switcher + 1d/3d/7d automatic decay receiver
      const javaDir = path.join(platformRoot, 'app', 'src', 'main', 'java', pkg, 'dynamicicon');
      fs.mkdirSync(javaDir, { recursive: true });
      const pkgDot = mod.android?.package || 'com.tana.linkup';
      const aliasMapEntries = VARIANTS.map((v) => `"${v.id}" to "${pkgDot}.${v.alias}"`).join(',\n      ');

      fs.writeFileSync(
        path.join(javaDir, 'LinkupDynamicIconModule.kt'),
        `package ${pkgDot}.dynamicicon

import android.app.Activity
import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LinkupDynamicIconModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), Application.ActivityLifecycleCallbacks {

  companion object {
    const val PREFS = "linkup_dynamic_icon"
    const val KEY_DESIRED = "desired_variant"
    const val KEY_APPLIED = "applied_variant"
    const val KEY_MODE = "icon_mode"
    const val KEY_LAST_SEEN = "last_seen_epoch_ms"
    private const val DAY_MS = 86_400_000L

    val ALIASES = mapOf(
      ${aliasMapEntries}
    )

    fun applyVariantSwap(ctx: Context, target: String) {
      try {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val applied = prefs.getString(KEY_APPLIED, "default") ?: "default"
        val safeTarget = if (ALIASES.containsKey(target)) target else "default"
        if (safeTarget == applied) return
        val desiredClass = ALIASES[safeTarget] ?: return
        val pm = ctx.packageManager
        pm.setComponentEnabledSetting(
          ComponentName(ctx.packageName, desiredClass),
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
          PackageManager.DONT_KILL_APP
        )
        for ((key, cls) in ALIASES) {
          if (key != safeTarget) {
            pm.setComponentEnabledSetting(
              ComponentName(ctx.packageName, cls),
              PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
              PackageManager.DONT_KILL_APP
            )
          }
        }
        prefs.edit().putString(KEY_APPLIED, safeTarget).apply()
      } catch (_: Throwable) {}
    }

    fun scheduleInactivityDecayAlarms(ctx: Context) {
      try {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val mode = prefs.getString(KEY_MODE, "auto") ?: "auto"
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val milestones = listOf(1 to "angry_1d", 3 to "sad_inactive", 7 to "ghost_abandoned")
        for ((days, variant) in milestones) {
          val intent = Intent(ctx, LinkupIconDecayReceiver::class.java).apply {
            putExtra("variant", variant)
            putExtra("days", days)
          }
          val pi = PendingIntent.getBroadcast(
            ctx,
            7100 + days,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
          )
          if (mode != "auto") {
            am.cancel(pi)
          } else {
            am.set(
              AlarmManager.ELAPSED_REALTIME,
              SystemClock.elapsedRealtime() + days * DAY_MS,
              pi
            )
          }
        }
      } catch (_: Throwable) {}
    }

    fun cancelInactivityDecayAlarms(ctx: Context) {
      try {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        for (days in listOf(1, 3, 7)) {
          val intent = Intent(ctx, LinkupIconDecayReceiver::class.java)
          val pi = PendingIntent.getBroadcast(
            ctx,
            7100 + days,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
          )
          if (pi != null) am.cancel(pi)
        }
      } catch (_: Throwable) {}
    }
  }

  private var startedActivities = 0

  init {
    (reactContext.applicationContext as? Application)?.registerActivityLifecycleCallbacks(this)
  }

  override fun getName(): String = "LinkupDynamicIcon"

  @ReactMethod
  fun getCurrentIcon(promise: Promise) {
    val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    promise.resolve(prefs.getString(KEY_DESIRED, prefs.getString(KEY_APPLIED, "default")) ?: "default")
  }

  @ReactMethod
  fun setIconMode(mode: String?, promise: Promise) {
    val safeMode = if (mode.isNullOrBlank()) "auto" else mode
    val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_MODE, safeMode).apply()
    if (safeMode != "auto") cancelInactivityDecayAlarms(reactContext.applicationContext)
    promise.resolve(safeMode)
  }

  @ReactMethod
  fun setAlternateIcon(variantId: String?, promise: Promise) {
    val target = if (variantId != null && ALIASES.containsKey(variantId)) variantId else "default"
    val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_DESIRED, target).apply()
    if (startedActivities <= 0) {
      applyVariantSwap(reactContext.applicationContext, target)
    }
    promise.resolve(target)
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
  override fun onActivityStarted(activity: Activity) {
    startedActivities++
    cancelInactivityDecayAlarms(activity.applicationContext)
    activity.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putLong(KEY_LAST_SEEN, System.currentTimeMillis())
      .apply()
  }
  override fun onActivityResumed(activity: Activity) {}
  override fun onActivityPaused(activity: Activity) {}
  override fun onActivityStopped(activity: Activity) {
    startedActivities = (startedActivities - 1).coerceAtLeast(0)
    if (startedActivities == 0) {
      val ctx = activity.applicationContext
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      prefs.edit().putLong(KEY_LAST_SEEN, System.currentTimeMillis()).apply()
      val desired = prefs.getString(KEY_DESIRED, "default") ?: "default"
      applyVariantSwap(ctx, desired)
      scheduleInactivityDecayAlarms(ctx)
    }
  }
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
  override fun onActivityDestroyed(activity: Activity) {}
}
`,
      );

      fs.writeFileSync(
        path.join(javaDir, 'LinkupIconDecayReceiver.kt'),
        `package ${pkgDot}.dynamicicon

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class LinkupIconDecayReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val prefs = context.getSharedPreferences(LinkupDynamicIconModule.PREFS, Context.MODE_PRIVATE)
    val mode = prefs.getString(LinkupDynamicIconModule.KEY_MODE, "auto") ?: "auto"
    if (mode != "auto") return

    if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
      val lastSeen = prefs.getLong(LinkupDynamicIconModule.KEY_LAST_SEEN, 0L)
      if (lastSeen > 0L) {
        val daysAway = ((System.currentTimeMillis() - lastSeen) / 86_400_000L).toInt()
        val bootVariant = when {
          daysAway >= 7 -> "ghost_abandoned"
          daysAway >= 3 -> "sad_inactive"
          daysAway >= 1 -> "angry_1d"
          else -> null
        }
        if (bootVariant != null) {
          prefs.edit().putString(LinkupDynamicIconModule.KEY_DESIRED, bootVariant).apply()
          LinkupDynamicIconModule.applyVariantSwap(context, bootVariant)
        }
      }
      LinkupDynamicIconModule.scheduleInactivityDecayAlarms(context)
      return
    }

    val variant = intent?.getStringExtra("variant") ?: return
    prefs.edit().putString(LinkupDynamicIconModule.KEY_DESIRED, variant).apply()
    LinkupDynamicIconModule.applyVariantSwap(context, variant)
  }
}
`,
      );

      fs.writeFileSync(
        path.join(javaDir, 'LinkupDynamicIconPackage.kt'),
        `package ${pkgDot}.dynamicicon

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LinkupDynamicIconPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(LinkupDynamicIconModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`,
      );

      return mod;
    },
  ]);

  config = withMainApplication(config, (mod) => {
    const pkgDot = mod.android?.package || 'com.tana.linkup';
    const importLine = `import ${pkgDot}.dynamicicon.LinkupDynamicIconPackage`;
    let src = mod.modResults.contents;
    if (!src.includes(importLine)) {
      src = src.replace(/(package\s+[^\n]+\n)/, `$1${importLine}\n`);
    }
    if (!src.includes('LinkupDynamicIconPackage()')) {
      src = src.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n              add(LinkupDynamicIconPackage())',
      );
    }
    mod.modResults.contents = src;
    return mod;
  });

  return config;
}

function withIosDynamicIcons(config) {
  config = withInfoPlist(config, (mod) => {
    const alternates = {};
    for (const v of VARIANTS) {
      if (!v.iosName) continue;
      alternates[v.iosName] = {
        CFBundleIconFiles: [v.iosName],
        UIPrerenderedIcon: false,
      };
    }
    mod.modResults.CFBundleIcons = {
      ...(mod.modResults.CFBundleIcons || {}),
      CFBundleAlternateIcons: alternates,
    };
    mod.modResults['CFBundleIcons~ipad'] = {
      ...(mod.modResults['CFBundleIcons~ipad'] || {}),
      CFBundleAlternateIcons: alternates,
    };
    return mod;
  });

  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const appName = mod.modRequest.projectName || 'LINKUP';
      const iosAppDir = path.join(mod.modRequest.platformProjectRoot, appName);
      if (fs.existsSync(iosAppDir)) {
        for (const v of VARIANTS) {
          if (!v.iosName) continue;
          const src = path.join(projectRoot, 'assets', v.asset);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(iosAppDir, `${v.iosName}@2x.png`));
            fs.copyFileSync(src, path.join(iosAppDir, `${v.iosName}@3x.png`));
          }
        }
      }
      return mod;
    },
  ]);

  return config;
}

module.exports = function withDynamicLauncherIcon(config) {
  config = withAndroidDynamicIcons(config);
  config = withIosDynamicIcons(config);
  return config;
};
module.exports.VARIANTS = VARIANTS;
