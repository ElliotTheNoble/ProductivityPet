import { LanguageCard } from '@/components/language-card';
import { useT, type StringKey } from '@/i18n';
import { FamilyModeCard } from '@/components/family-mode-card';
import { devDeliverPawadiseMailNow } from '@/utils/pawadise-mail';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { ConfirmModal } from '@/components/confirm-modal';
import {
  DEV_DIRTY_TEST_CLEANLINESS_VALUE,
  DEV_ENABLE_DIRTY_TEST_CONTROLS,
  DEV_ENABLE_HATCH_INTRO_PREVIEW,
  DEV_ENABLE_LIFECYCLE_TEST_CONTROLS,
  DEV_ENABLE_TEST_PAW_TOKEN_GRANT,
  DEV_TEST_PAW_TOKEN_GRANT_AMOUNT,
} from '@/utils/dev-flags';
import { requestDevHatchReplay } from '@/utils/dev-hatch-replay';
import type { DevHealthState } from '@/utils/pet-family';
import { getGrowthEligibility, getRenderedStage, getRenderedStageIndex, growPet } from '@/utils/pet-growth';
import { applyAddPoopPile, applyClearAllPiles, applyDevFastForwardAccumulation } from '@/utils/pet-poop';
import { getPetProfile, savePetProfile, subscribeToPetProfile, type PetProfile } from '@/utils/pet-profile';
import { getCachedTasks } from '@/utils/task-storage';
import { getCompletedTaskCount, type Task } from '@/utils/tasks';
import { setDevPreviewStageIndex } from '@/utils/dev-stage-preview';
import { PET_STAGES } from '@/utils/pet-stage';
import {
  ALERT_HOURS,
  DEFAULT_ALERT_SETTINGS,
  getAlertSettings,
  saveAlertSettings,
  sendTestNotification,
  setNotificationsEnabled,
  subscribeToAlertSettings,
  triggerTestCriticalAlert,
  type PetAlertSettings,
} from '@/utils/pet-alerts';
import { captureProfileOwner, isProfileOwner } from '@/utils/profiles';
import { devAddGrowthToSelectedPet, devSetSelectedHealthState, devSetSelectedNeed, devSetSelectedPetActualStage, devShiftSicknessBack, getSelectedPet } from '@/utils/pet-family';
import { RECOVERY_NEED_THRESHOLD } from '@/utils/pet-family-config';

// Pet Care & Alerts: a friendly page for children — a short "how to keep your
// pets happy" card, three simple alert switches, and a note that the player is
// always in control. The grown-up detail is tucked into two collapsed sections
// (How Pet Health Works, Phone Help & Testing), and the developer lifecycle
// buttons only appear in development builds. The alert behaviour itself lives
// in @/utils/pet-alerts.ts and is unchanged.

// Developer buttons are shown only when the flag is on AND this is a
// development build (__DEV__ is false in a production release).
const SHOW_DEVELOPER_TOOLS = DEV_ENABLE_LIFECYCLE_TEST_CONTROLS && __DEV__;

type IconName = ComponentProps<typeof Ionicons>['name'];

// Simple line icons (Ionicons outline set) — one per care action.
const CARE_ACTIONS: { icon: IconName; label: StringKey }[] = [
  { icon: 'restaurant-outline', label: 'alFeed' },
  { icon: 'water-outline', label: 'alBathe' },
  { icon: 'game-controller-outline', label: 'alPlay' },
  { icon: 'moon-outline', label: 'alRest' },
];

// The page's pastel palette.
const INK = '#6B4A5A';
const PINK = '#FFE9F0';
const LAVENDER = '#F0E9FB';
const MINT = '#E4F6EE';
const CREAM = '#FFF8EF';
const SWITCH_ON = '#7FD9B6';
const SWITCH_OFF = '#DAD3E0';
const ICON_COLOR = '#B07A96';

// A tiny decorative paw / heart / sparkle tucked in a card's corner.
function Sparkle({ name, style }: { name: IconName; style: object }) {
  return (
    <View pointerEvents="none" style={[styles.sparkle, style]}>
      <Ionicons name={name} size={14} color="#E9B7CD" />
    </View>
  );
}

function Card({ children, tint, deco }: { children: ReactNode; tint: string; deco?: ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: tint }]}>
      {deco}
      {children}
    </View>
  );
}

// A card whose body is hidden until the header is tapped.
function Collapsible({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.card, styles.collapsibleCard]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={({ pressed }) => [styles.collapsibleHeader, styles.pointer, pressed && styles.pressed]}>
        <View style={styles.smallCircle}>
          <Ionicons name={icon} size={16} color={ICON_COLOR} />
        </View>
        <ThemedText style={styles.collapsibleTitle}>{title}</ThemedText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={ICON_COLOR} />
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

function Toggle({
  icon,
  label,
  description,
  value,
  onChange,
  disabled,
  last,
}: {
  icon: IconName;
  label: string;
  description: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, !last && styles.toggleDivider]}>
      <View style={styles.smallCircle}>
        <Ionicons name={icon} size={18} color={ICON_COLOR} />
      </View>
      <View style={styles.toggleText}>
        <ThemedText type="smallBold" style={styles.toggleLabel}>
          {label}
        </ThemedText>
        <ThemedText type="small" style={styles.toggleDescription}>
          {description}
        </ThemedText>
      </View>
      {/* Small, cute switch: mint when on, soft gray when off. The wrapper keeps a comfortable touch area. */}
      <View style={styles.switchWrap}>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: SWITCH_OFF, true: SWITCH_ON }}
          thumbColor="#FFFFFF"
          style={styles.switch}
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityState={{ checked: value, disabled: !!disabled }}
        />
      </View>
    </View>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      <View style={[styles.smallButton, styles.pointer]}>
        <ThemedText type="small" style={styles.smallButtonText}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

// Development-only testing tools, grouped into collapsible sections. Every action here
// acts on the SELECTED pet only (the pet-family store's facade enforces that). The
// Pet Stage Preview (display-only) lives on Home's "Pet Progress" panel, on the stage icons.
function DeveloperTools({
  selected,
  onPickStage,
}: {
  selected: { name: string | null; lifecycle: { state: string } };
  onPickStage: (index: number) => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<PetProfile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isGrowing, setIsGrowing] = useState(false);
  const [growResultMessage, setGrowResultMessage] = useState<string | null>(null);
  // Developer Health State: the option picked in the list and the result of the last Apply.
  const [healthChoice, setHealthChoice] = useState<DevHealthState>(
    (selected.lifecycle.state as DevHealthState) ?? 'healthy'
  );
  const [healthResult, setHealthResult] = useState<string | null>(null);
  const [mailResult, setMailResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPetProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {});
    getCachedTasks()
      .then((cached) => {
        if (!cancelled) setTasks(cached);
      })
      .catch(() => {});
    const off = subscribeToPetProfile((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const completedTaskCount =
    profile?.growthCredit !== undefined ? Math.floor(profile.growthCredit) : getCompletedTaskCount(tasks);
  const petStage = getRenderedStage(completedTaskCount, profile?.paidStageIndex ?? 0);
  // The REAL saved stage (never the Stage Preview): the real poop system refuses to add piles
  // to an unhatched Egg, so these shortcuts don't either.
  const isRealEgg = profile !== null && petStage === 'Egg' && !profile.hatchedAt;
  const renderedStageIndex = getRenderedStageIndex(completedTaskCount, profile?.paidStageIndex ?? 0);
  const growthEligibility = getGrowthEligibility(renderedStageIndex, completedTaskCount);

  function update(next: PetProfile | null | undefined) {
    if (!profile || !next || next === profile) return;
    savePetProfile(next);
    setProfile(next);
  }

  function handleGrow() {
    if (isGrowing) return;
    setIsGrowing(true);
    growPet(completedTaskCount)
      .then((result) => {
        if (result.success) setProfile(result.profile);
        setGrowResultMessage(
          result.success
            ? `Grew to ${result.newStage}!`
            : result.reason === 'insufficient-funds'
              ? 'Not enough Paw Tokens.'
              : 'Not eligible to grow yet.'
        );
      })
      .catch(() => setGrowResultMessage('Something went wrong.'))
      .finally(() => setIsGrowing(false));
  }

  return (
    <>
      <Card tint={CREAM}>
        <View style={styles.headingRow}>
          <Ionicons name="flask-outline" size={16} color={ICON_COLOR} />
          <ThemedText style={styles.heading}>Developer Tools</ThemedText>
        </View>
        <ThemedText type="small" style={styles.mutedText}>
          For testing only — shown in development builds, never in a production release. Every action acts on the
          selected pet ({selected.name ?? 'your pet'}, {selected.lifecycle.state}) and uses the real health rules, so a
          pet really becomes sick / critical / passes away. Eggs can't get sick, so a new Egg first needs real growth:
          use "+10 growth" in Pet Growth and Stages. Open a section below to use its tools.
        </ThemedText>
      </Card>

      <Collapsible title="Pet Needs" icon="heart-outline">
        <ThemedText type="small" style={styles.mutedText}>
          Sets the selected pet's real needs.
        </ThemedText>
        <View style={styles.buttonRow}>
          <SmallButton label="Dev: Set Happiness to 0%" onPress={() => devSetSelectedNeed('happiness', 0)} />
          <SmallButton label="Dev: Set Happiness to 25%" onPress={() => devSetSelectedNeed('happiness', 25)} />
          <SmallButton label="Dev: Set Happiness to 50%" onPress={() => devSetSelectedNeed('happiness', 50)} />
          <SmallButton label="Dev: Restore Happiness to 100%" onPress={() => devSetSelectedNeed('happiness', 100)} />
        </View>
        <View style={styles.buttonRow}>
          <SmallButton label="Hunger → 0" onPress={() => devSetSelectedNeed('hunger', 0)} />
          <SmallButton label="Cleanliness → 0" onPress={() => devSetSelectedNeed('cleanliness', 0)} />
          <SmallButton label="Happiness → 0" onPress={() => devSetSelectedNeed('happiness', 0)} />
          <SmallButton label="Energy → 0" onPress={() => devSetSelectedNeed('energy', 0)} />
        </View>
        <View style={styles.buttonRow}>
          <SmallButton
            label="Hunger, Cleanliness, Happiness → 100"
            onPress={() => {
              devSetSelectedNeed('hunger', 100);
              devSetSelectedNeed('cleanliness', 100);
              devSetSelectedNeed('happiness', 100);
            }}
          />
        </View>
      </Collapsible>

      <Collapsible title="Pet Growth and Stages" icon="trending-up-outline">
        <ThemedText type="smallBold">Dev: Set Actual Stage (real, saved)</ThemedText>
        <ThemedText type="small" style={styles.mutedText}>
          Changes this pet's REAL stage so its care, poop, play and health rules apply. Different from the Pet Stage
          Preview (tap a stage icon in Home's Pet Progress panel), which only changes the picture.
        </ThemedText>
        <View style={styles.buttonRow}>
          {PET_STAGES.map((stage, index) => (
            <SmallButton key={stage} label={stage} onPress={() => onPickStage(index)} />
          ))}
        </View>
        <View style={styles.buttonRow}>
          <SmallButton label="+10 growth tasks (hatches an Egg)" onPress={() => devAddGrowthToSelectedPet(10)} />
        </View>
        {growthEligibility.canGrow || growResultMessage ? (
          <>
            <ThemedText type="small" style={styles.mutedText}>
              Paid growth (spends the shared Paw Tokens, exactly like the real growth system):
            </ThemedText>
            {growthEligibility.canGrow ? (
              <View style={styles.buttonRow}>
                <SmallButton
                  label={
                    isGrowing
                      ? 'Growing…'
                      : `Grow to ${growthEligibility.nextStage} (${growthEligibility.cost} 🐾)`
                  }
                  onPress={handleGrow}
                />
              </View>
            ) : null}
            {growResultMessage ? (
              <ThemedText type="small" style={styles.mutedText}>
                {growResultMessage}
              </ThemedText>
            ) : null}
          </>
        ) : null}
      </Collapsible>

      <Collapsible title="Health and Lifecycle Testing" icon="pulse-outline">
        <ThemedText type="smallBold">Developer Health State</ThemedText>
        <ThemedText type="small" style={styles.mutedText}>
          Sets the selected pet's REAL, saved health state in any direction (even Deceased → Sick / Critical /
          Healthy). No Paw Tokens are charged, no ambulance animation plays, and no alerts are sent. The normal
          sickness, death and paid-resurrection rules are unchanged.
        </ThemedText>
        <View style={styles.buttonRow}>
          {(['healthy', 'sick', 'critical', 'deceased'] as DevHealthState[]).map((option) => (
            <Pressable
              key={option}
              onPress={() => setHealthChoice(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected: healthChoice === option }}
              style={({ pressed }) => pressed && styles.pressed}>
              <View
                style={[
                  styles.smallButton,
                  styles.pointer,
                  healthChoice === option && { backgroundColor: '#DCCBF5', borderColor: '#A78BDB' },
                ]}>
                <ThemedText type="small" style={styles.smallButtonText}>
                  {`${healthChoice === option ? '● ' : '○ '}${option.charAt(0).toUpperCase()}${option.slice(1)}`}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
        <View style={styles.buttonRow}>
          <SmallButton
            label={`Apply State (${healthChoice})`}
            onPress={() => {
              const result = devSetSelectedHealthState(healthChoice);
              setHealthResult(result.ok ? `Applied: ${healthChoice}.` : result.reason);
            }}
          />
        </View>
        {healthResult ? (
          <ThemedText type="small" style={styles.mutedText}>
            {healthResult}
          </ThemedText>
        ) : null}
        <ThemedText type="smallBold">Illness timers</ThemedText>
        <ThemedText type="small" style={styles.mutedText}>
          Make the selected pet's illness older (real timers). Use Pet Needs to make it sick or to recover it.
        </ThemedText>
        <View style={styles.buttonRow}>
          <SmallButton label="Sickness 24h older (→ Critical)" onPress={() => devShiftSicknessBack(24)} />
          <SmallButton label="Sickness 72h older" onPress={() => devShiftSicknessBack(72)} />
          <SmallButton label="Sickness 96h older (→ passes away)" onPress={() => devShiftSicknessBack(96)} />
        </View>
      </Collapsible>

      <Collapsible title="Poop and Bath Testing" icon="water-outline">
        {DEV_ENABLE_DIRTY_TEST_CONTROLS ? (
          <>
            <View style={styles.buttonRow}>
              <SmallButton
                label={`Dev: Set Cleanliness to ${DEV_DIRTY_TEST_CLEANLINESS_VALUE}%`}
                onPress={() => update(profile ? { ...profile, cleanliness: DEV_DIRTY_TEST_CLEANLINESS_VALUE } : null)}
              />
              <SmallButton
                label="Dev: Restore Cleanliness to 100%"
                onPress={() => update(profile ? { ...profile, cleanliness: 100 } : null)}
              />
            </View>
            {!isRealEgg ? (
              <View style={styles.buttonRow}>
                <SmallButton
                  label="Dev: Add Poop Pile (Random Size)"
                  onPress={() => profile && update(applyAddPoopPile(profile, petStage))}
                />
                <SmallButton
                  label="Dev: Add Small Pile (1 cleanup)"
                  onPress={() => profile && update(applyAddPoopPile(profile, petStage, new Date(), 'small'))}
                />
                <SmallButton
                  label="Dev: Add Medium Pile (2 cleanups)"
                  onPress={() => profile && update(applyAddPoopPile(profile, petStage, new Date(), 'medium'))}
                />
                <SmallButton
                  label="Dev: Add Large Pile (3 cleanups)"
                  onPress={() => profile && update(applyAddPoopPile(profile, petStage, new Date(), 'large'))}
                />
                <SmallButton
                  label="Dev: Fast-Forward Accumulation (+2h)"
                  onPress={() => profile && update(applyDevFastForwardAccumulation(profile, petStage))}
                />
              </View>
            ) : (
              <ThemedText type="small" style={styles.mutedText}>
                Poop triggers disabled — this pet is still an Egg
              </ThemedText>
            )}
            {profile?.poopPiles && profile.poopPiles.length > 0 ? (
              <ThemedText type="small" style={styles.mutedText}>
                {`Active piles: ${profile.poopPiles.length}/5 (${profile.poopPiles.map((p) => p.size).join(', ')})`}
              </ThemedText>
            ) : null}
            <View style={styles.buttonRow}>
              <SmallButton
                label="Dev: Clear All Piles"
                onPress={() => profile && update(applyClearAllPiles(profile))}
              />
              <SmallButton
                label="Dev: Reset needsBath"
                onPress={() => update(profile ? { ...profile, needsBath: false } : null)}
              />
            </View>
          </>
        ) : (
          <ThemedText type="small" style={styles.mutedText}>
            Poop and bath testing is switched off (DEV_ENABLE_DIRTY_TEST_CONTROLS).
          </ThemedText>
        )}
      </Collapsible>

      <Collapsible title="Paw Token Testing" icon="cash-outline">
        {DEV_ENABLE_TEST_PAW_TOKEN_GRANT ? (
          <View style={styles.buttonRow}>
            <SmallButton
              label={`Dev: +${DEV_TEST_PAW_TOKEN_GRANT_AMOUNT} Paw Tokens`}
              onPress={() => update(profile ? { ...profile, pawTokens: profile.pawTokens + DEV_TEST_PAW_TOKEN_GRANT_AMOUNT } : null)}
            />
          </View>
        ) : (
          <ThemedText type="small" style={styles.mutedText}>
            Paw Token testing is switched off (DEV_ENABLE_TEST_PAW_TOKEN_GRANT).
          </ThemedText>
        )}
      </Collapsible>

      <Collapsible title="Pet Pawadise Testing" icon="mail-outline">
        <ThemedText type="small" style={styles.mutedText}>
          Makes a postcard arrive from every pet that is retired in Pawadise right now (they then wait on Home as a
          mailbox). Real deliveries come 2-5 days apart; this skips the wait.
        </ThemedText>
        <View style={styles.buttonRow}>
          <SmallButton label="Dev: Deliver Pawadise postcards now" onPress={() => void devDeliverPawadiseMailNow().then(setMailResult)} />
        </View>
        {mailResult ? <ThemedText type="small">{mailResult}</ThemedText> : null}
      </Collapsible>

      <Collapsible title="Hatching and Animation Testing" icon="egg-outline">
        {DEV_ENABLE_HATCH_INTRO_PREVIEW ? (
          <>
            <ThemedText type="small" style={styles.mutedText}>
              Replays the Egg-to-Hatchling animation on Home (purely visual — nothing is saved).
            </ThemedText>
            <View style={styles.buttonRow}>
              <SmallButton
                label="Dev: Replay Hatching Animation"
                onPress={() => {
                  requestDevHatchReplay();
                  router.push('/');
                }}
              />
            </View>
          </>
        ) : (
          <ThemedText type="small" style={styles.mutedText}>
            Hatching replay is switched off (DEV_ENABLE_HATCH_INTRO_PREVIEW).
          </ThemedText>
        )}
      </Collapsible>
    </>
  );
}

export function PetAlertsScreen() {
  const { t } = useT();
  const router = useRouter();
  const family = usePetFamily();
  const [settings, setSettings] = useState<PetAlertSettings>(DEFAULT_ALERT_SETTINGS);
  // The switches stay disabled until the player's SAVED choices have loaded, so
  // nothing can be changed (or shown wrongly) before they are known.
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<StringKey | null>(null);
  const [helpMessage, setHelpMessage] = useState<StringKey | null>(null);
  // Developer Tools: the actual stage waiting for the player's confirmation.
  const [pendingStageIndex, setPendingStageIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAlertSettings().then((s) => {
      if (cancelled) return;
      setSettings(s);
      setLoaded(true);
    });
    const off = subscribeToAlertSettings(setSettings);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  async function handleNotifications(next: boolean) {
    const ok = await setNotificationsEnabled(next);
    setMessage(ok ? null : 'alMsgBlocked');
  }

  async function handleFlash(next: boolean) {
    // The camera permission prompt can stay open for a long time: if the profile session that opened this screen is over by then,
    // the setting is not saved into whichever profile is open now.
    const owner = captureProfileOwner();
    if (!next) {
      await saveAlertSettings({ flash: false });
      setMessage(null);
      return;
    }
    if (Platform.OS === 'web') {
      setMessage('alMsgFlashWeb');
      return;
    }
    try {
      const { Camera } = require('expo-camera') as typeof import('expo-camera');
      const result = await Camera.requestCameraPermissionsAsync();
      if (!result.granted) {
        setMessage('alMsgFlashPermission');
        return;
      }
      if (!isProfileOwner(owner)) return;
      await saveAlertSettings({ flash: true });
      setMessage(null);
    } catch {
      setMessage('alMsgFlashUnavailable');
    }
  }

  async function handleTestNotification() {
    const ok = await sendTestNotification();
    setHelpMessage(ok ? 'alMsgTestSent' : 'alMsgTestFailed');
  }

  const selected = family ? getSelectedPet(family) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.page}>
            <Pressable
              onPress={() => router.replace('/')}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.pressed}>
              <View style={[styles.back, styles.pointer]}>
                <Ionicons name="arrow-back" size={14} color={INK} />
                <ThemedText type="smallBold" style={styles.backText}>
                  {t('alHome')}
                </ThemedText>
              </View>
            </Pressable>

            <View style={styles.titleRow}>
              <Ionicons name="paw" size={20} color="#E39ABB" />
              <ThemedText style={styles.title}>{t('alTitle')}</ThemedText>
            </View>

            {/* 1. Keep Your Pets Happy! */}
            <Card
              tint={PINK}
              deco={
                <>
                  <Sparkle name="heart" style={{ top: 8, right: 12 }} />
                  <Sparkle name="sparkles" style={{ bottom: 8, left: 10 }} />
                </>
              }>
              <View style={styles.headingRow}>
                <ThemedText style={styles.heading}>{t('alKeepHappy')}</ThemedText>
                <Ionicons name="paw" size={14} color="#E39ABB" />
              </View>
              <ThemedText type="small" style={styles.subheading}>
                {t('alLittleLove')}
              </ThemedText>
              <View style={styles.careRow}>
                {CARE_ACTIONS.map((action) => (
                  <View key={action.label} style={styles.careItem} accessible accessibilityLabel={t(action.label)}>
                    <View style={styles.careCircle}>
                      <Ionicons name={action.icon} size={24} color={ICON_COLOR} />
                    </View>
                    <ThemedText type="smallBold" style={styles.careLabel}>
                      {t(action.label)}
                    </ThemedText>
                  </View>
                ))}
              </View>
              <ThemedText type="small" style={styles.bodyText}>
                {t('alCareBody')}
              </ThemedText>
            </Card>

            {/* 2. Pet Alerts */}
            <Card tint={LAVENDER} deco={<Sparkle name="paw" style={{ top: 8, right: 12 }} />}>
              <ThemedText style={styles.heading}>{t('alPetAlerts')}</ThemedText>
              <View>
                <Toggle
                  icon="notifications-outline"
                  label={t('alRemindLabel')}
                  description={t('alRemindDesc')}
                  value={settings.notifications}
                  onChange={handleNotifications}
                  disabled={!loaded}
                />
                <Toggle
                  icon="phone-portrait-outline"
                  label={t('alVibrateLabel')}
                  description={t('alVibrateDesc')}
                  value={settings.vibration}
                  onChange={(v) => saveAlertSettings({ vibration: v })}
                  disabled={!loaded}
                />
                <Toggle
                  icon="flashlight-outline"
                  label={t('alFlashLabel')}
                  description={t('alFlashDesc')}
                  value={settings.flash}
                  onChange={handleFlash}
                  disabled={!loaded}
                  last
                />
              </View>
              {message ? (
                <ThemedText type="small" themeColor="accent">
                  {t(message)}
                </ThemedText>
              ) : null}
            </Card>

            {/* 3. You're in Control! */}
            <Card tint={MINT} deco={<Sparkle name="heart" style={{ top: 8, right: 12 }} />}>
              <ThemedText style={styles.heading}>{t('alControl')}</ThemedText>
              <ThemedText type="small" style={styles.bodyText}>
                {t('alControlBody')}
              </ThemedText>
            </Card>

            <Collapsible title={t('alHealthTitle')} icon="heart-outline">
              <ThemedText type="small" style={styles.bodyText}>
                {t('alHealth1')} <ThemedText type="smallBold">{t('alSickWord')}</ThemedText>{' '}
                {t('alHealth2', { h1: ALERT_HOURS.sickToCritical })}{' '}
                <ThemedText type="smallBold">{t('alCriticalWord')}</ThemedText>
                {t('alHealth3', {
                  h2: ALERT_HOURS.criticalToDeath,
                  total: ALERT_HOURS.sickToCritical + ALERT_HOURS.criticalToDeath,
                  n: RECOVERY_NEED_THRESHOLD,
                })}
              </ThemedText>
              <ThemedText type="small" style={styles.mutedText}>
                {t('alHealthEnergy')}
              </ThemedText>
            </Collapsible>

            <Collapsible title={t('alPhoneTitle')} icon="help-circle-outline">
              <ThemedText type="smallBold" style={styles.bodyText}>
                {t('alSamsung')}
              </ThemedText>
              <ThemedText type="small" style={styles.bodyText}>
                {t('alSamsungBody')}
              </ThemedText>
              <ThemedText type="small" style={styles.mutedText}>
                {t('alAndroidNote')}
              </ThemedText>
              <ThemedText type="smallBold" style={styles.bodyText}>
                {t('alTryIt')}
              </ThemedText>
              <View style={styles.buttonRow}>
                <SmallButton label={t('alSendTest')} onPress={handleTestNotification} />
                <SmallButton label={t('alTestVib')} onPress={triggerTestCriticalAlert} />
              </View>
              {helpMessage ? (
                <ThemedText type="small" style={styles.mutedText}>
                  {t(helpMessage)}
                </ThemedText>
              ) : null}
            </Collapsible>

            <LanguageCard />

            <FamilyModeCard />

            {SHOW_DEVELOPER_TOOLS && selected ? <DeveloperTools selected={selected} onPickStage={setPendingStageIndex} /> : null}
          </View>
        </ScrollView>
        <ConfirmModal
          visible={SHOW_DEVELOPER_TOOLS && pendingStageIndex !== null}
          title="Change the real stage?"
          confirmLabel="Change stage"
          onConfirm={() => {
            if (pendingStageIndex !== null) {
              devSetSelectedPetActualStage(pendingStageIndex);
              // The picture should match the real stage afterwards.
              setDevPreviewStageIndex(null);
            }
            setPendingStageIndex(null);
          }}
          onCancel={() => setPendingStageIndex(null)}>
          <ThemedText type="small">
            This sets the selected pet's real stage to {pendingStageIndex !== null ? PET_STAGES[pendingStageIndex] : ''} and
            SAVES it — it stays after a refresh. Its growth progress is adjusted to match; no Paw Tokens or completed
            tasks are given. Other pets are not changed.
          </ThemedText>
        </ConfirmModal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { alignItems: 'center', padding: Spacing.three, paddingBottom: Spacing.five },
  // Compact, centered column that stays a comfortable width on desktop.
  page: { width: '100%', maxWidth: 520, gap: Spacing.two + 2 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: '#FFFFFFCC',
    borderWidth: 1.5,
    borderColor: '#F3D3E1',
  },
  backText: { color: INK },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800', color: INK },
  card: {
    borderRadius: 26,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
    gap: Spacing.two,
    borderWidth: 1.5,
    borderColor: '#FFFFFFE6',
    shadowColor: '#B07A96',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  collapsibleCard: { backgroundColor: '#FFFFFFD9', paddingVertical: Spacing.two + 2 },
  sparkle: { position: 'absolute', opacity: 0.7 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '800', color: INK },
  subheading: { color: '#9A7388', marginTop: -4 },
  bodyText: { color: INK, fontSize: 13, lineHeight: 19 },
  mutedText: { color: '#8C7083', fontSize: 12, lineHeight: 18 },
  careRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.one },
  careItem: { alignItems: 'center', gap: Spacing.one, minWidth: 60 },
  careCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B07A96',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 1,
  },
  careLabel: { color: INK, fontSize: 12, lineHeight: 16 },
  smallCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: Spacing.two },
  toggleDivider: { borderBottomWidth: 1, borderBottomColor: '#E5DAF3' },
  toggleText: { flex: 1, gap: 1 },
  toggleLabel: { color: INK, fontSize: 14, lineHeight: 19 },
  toggleDescription: { color: '#8C7083', fontSize: 12, lineHeight: 16 },
  // 44px-wide touch area around a switch drawn at 80% size.
  switchWrap: { width: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  switch: { transform: [{ scale: 0.8 }] },
  collapsibleHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 36 },
  collapsibleTitle: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700', color: INK },
  collapsibleBody: { gap: Spacing.two, paddingTop: Spacing.one },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  smallButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#F3D3E1',
    justifyContent: 'center',
  },
  smallButtonText: { color: INK, fontSize: 12 },
  pressed: { opacity: 0.8 },
  pointer: { cursor: 'pointer' },
});
