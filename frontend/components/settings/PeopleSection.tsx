"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, GitMerge, Link as LinkIcon, Trash2, UserX, Wallet } from "lucide-react";
import Card from "@/components/Card";
import Avatar from "@/components/Avatar";
import ConfirmButton from "@/components/ConfirmButton";
import Button from "@/components/Button";
import Dialog from "@/components/Dialog";
import Select from "@/components/Select";
import {
  ApiError,
  createInvite,
  createMember,
  deleteMember,
  getCurrencyRates,
  getTripAccess,
  mergeMember,
  removeTripAccess,
  updateMember,
  updateTripAccessRole,
} from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import { CURATED_CURRENCIES, formatCurrencyOption } from "@/lib/currencies";
import type { Member, TripAccessUser, TripDetail } from "@/lib/types";

/** Keeps only digits and at most one decimal point — same filtering used
 * throughout this app's amount/rate inputs (see ExpenseFormDialog.tsx /
 * the old TripInfoSection.tsx this per-member panel replaces) in place of
 * the native `<input type="number">`'s mouse-wheel-changes-the-value trap. */
function filterDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

function roundAmountForInput(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function roundRateForInput(n: number): string {
  return (Math.round(n * 1e6) / 1e6).toString();
}

/**
 * Per-member "初始換匯" editor — moved here from TripInfoSection.tsx (which
 * used to have exactly ONE such record for the whole trip): each person may
 * have exchanged a different amount at a different rate, so this is now one
 * record per Member (see backend models.Member's docstring for the five
 * initial_exchange_* fields this mirrors 1:1). Same interaction logic as the
 * old trip-wide version (fill any two of amount/amount/rate to get the third
 * suggested, live-rate lookup once both currencies are picked, nothing saved
 * until the user actually fills something in) — just scoped to one member
 * and saved via PUT /api/members/{id} (see lib/api.ts updateMember's
 * `exchange` param) instead of PUT /api/trips/{id}.
 */
function MemberExchangeDialog({
  member,
  open,
  onClose,
  onSaved,
}: {
  member: Member;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";

  const [fromCurrency, setFromCurrency] = useState(member.initial_exchange_from_currency ?? "");
  const [fromAmount, setFromAmount] = useState(
    member.initial_exchange_from_amount != null ? String(member.initial_exchange_from_amount) : ""
  );
  const [toCurrency, setToCurrency] = useState(member.initial_exchange_to_currency ?? "");
  const [toAmount, setToAmount] = useState(
    member.initial_exchange_to_amount != null ? String(member.initial_exchange_to_amount) : ""
  );
  const [rate, setRate] = useState(
    member.initial_exchange_rate != null ? String(member.initial_exchange_rate) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  // Reset the draft to this member's saved values every time the dialog
  // (re)opens for a (possibly different) member.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional form reset on (re)open
    setFromCurrency(member.initial_exchange_from_currency ?? "");
    setFromAmount(member.initial_exchange_from_amount != null ? String(member.initial_exchange_from_amount) : "");
    setToCurrency(member.initial_exchange_to_currency ?? "");
    setToAmount(member.initial_exchange_to_amount != null ? String(member.initial_exchange_to_amount) : "");
    setRate(member.initial_exchange_rate != null ? String(member.initial_exchange_rate) : "");
    setError(null);
    setRateNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member.id]);

  const fetchSuggestedRate = async (fromCode: string, toCode: string) => {
    if (!fromCode || !toCode || fromCode === toCode) return;
    setRateLoading(true);
    setRateNotice(null);
    try {
      const res = await getCurrencyRates(fromCode);
      const suggested = res.rates[toCode];
      if (suggested === undefined || suggested <= 0) {
        setRateNotice("查無此幣別組合的即時匯率，請手動輸入");
        return;
      }
      const suggestedRateStr = roundRateForInput(suggested);
      setRate(suggestedRateStr);
      const f = parseAmount(fromAmount);
      if (f != null && !Number.isNaN(f) && f > 0) {
        setToAmount(roundAmountForInput(f / suggested));
      }
      setRateNotice(`已帶入今日即時匯率（1 ${toCode} ≈ ${suggestedRateStr} ${fromCode}）作為預設建議，可自行改成當初實際換到的匯率`);
    } catch {
      setRateNotice("自動抓即時匯率失敗，請手動輸入匯率");
    } finally {
      setRateLoading(false);
    }
  };

  const onFromAmountChange = (v: string) => {
    setFromAmount(v);
    if (error) setError(null);
    const f = parseAmount(v);
    if (f == null || Number.isNaN(f) || f <= 0) return;
    const r = parseAmount(rate);
    if (r != null && !Number.isNaN(r) && r > 0) {
      setToAmount(roundAmountForInput(f / r));
      return;
    }
    const t = parseAmount(toAmount);
    if (t != null && !Number.isNaN(t) && t > 0) setRate(roundRateForInput(f / t));
  };

  const onToAmountChange = (v: string) => {
    setToAmount(v);
    if (error) setError(null);
    const t = parseAmount(v);
    if (t == null || Number.isNaN(t) || t <= 0) return;
    const r = parseAmount(rate);
    if (r != null && !Number.isNaN(r) && r > 0) {
      setFromAmount(roundAmountForInput(t * r));
      return;
    }
    const f = parseAmount(fromAmount);
    if (f != null && !Number.isNaN(f) && f > 0) setRate(roundRateForInput(f / t));
  };

  const onRateChange = (v: string) => {
    setRate(v);
    if (error) setError(null);
    const r = parseAmount(v);
    if (r == null || Number.isNaN(r) || r <= 0) return;
    const f = parseAmount(fromAmount);
    if (f != null && !Number.isNaN(f) && f > 0) {
      setToAmount(roundAmountForInput(f / r));
      return;
    }
    const t = parseAmount(toAmount);
    if (t != null && !Number.isNaN(t) && t > 0) setFromAmount(roundAmountForInput(t * r));
  };

  const onFromCurrencyChange = (v: string) => {
    setFromCurrency(v);
    if (error) setError(null);
    fetchSuggestedRate(v, toCurrency);
  };
  const onToCurrencyChange = (v: string) => {
    setToCurrency(v);
    if (error) setError(null);
    fetchSuggestedRate(fromCurrency, v);
  };

  const handleSave = async () => {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (from && to && from === to) {
      setError("換出與換入幣別不能相同，若整趟行程只使用一種幣別，這個欄位可以留空不填");
      return;
    }
    const fAmt = parseAmount(fromAmount);
    const tAmt = parseAmount(toAmount);
    const r = parseAmount(rate);
    if (fAmt !== null && (Number.isNaN(fAmt) || fAmt < 0)) return setError("換出金額請輸入 0 以上的數字");
    if (tAmt !== null && (Number.isNaN(tAmt) || tAmt < 0)) return setError("換入金額請輸入 0 以上的數字");
    if (r !== null && (Number.isNaN(r) || r <= 0)) return setError("匯率請輸入大於 0 的數字");

    setSaving(true);
    setError(null);
    try {
      await updateMember(member.id, member.name, {
        initial_exchange_from_currency: from || null,
        initial_exchange_from_amount: fAmt,
        initial_exchange_to_currency: to || null,
        initial_exchange_to_amount: tAmt,
        initial_exchange_rate: r,
      });
      onSaved();
      showToast(`已更新「${member.name}」的換匯紀錄`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "更新換匯紀錄失敗，請稍後再試");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="初始換匯紀錄" subtitle={`「${member.name}」這次帶了多少錢`}>
      <div className="space-y-3">
        <div className="border border-slate-200 rounded-lg p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10.5px] text-slate-400 mb-1">換出幣別</label>
              <Select
                value={fromCurrency}
                onChange={onFromCurrencyChange}
                disabled={saving}
                placeholder="未選擇"
                options={[
                  { value: "", label: "未選擇" },
                  ...CURATED_CURRENCIES.map((c) => ({ value: c.code, label: formatCurrencyOption(c) })),
                ]}
              />
            </div>
            <div>
              <label className="block text-[10.5px] text-slate-400 mb-1">換出金額</label>
              <input
                type="text"
                inputMode="decimal"
                className={inputCls}
                value={fromAmount}
                disabled={saving}
                placeholder="例如 20899"
                onChange={(e) => onFromAmountChange(filterDecimalInput(e.target.value))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-300 text-xs">
            <span className="flex-1 h-px bg-slate-100" />
            換成
            <span className="flex-1 h-px bg-slate-100" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10.5px] text-slate-400 mb-1">換入幣別</label>
              <Select
                value={toCurrency}
                onChange={onToCurrencyChange}
                disabled={saving}
                placeholder="未選擇"
                options={[
                  { value: "", label: "未選擇" },
                  ...CURATED_CURRENCIES.map((c) => ({ value: c.code, label: formatCurrencyOption(c) })),
                ]}
              />
            </div>
            <div>
              <label className="block text-[10.5px] text-slate-400 mb-1">換入金額（實際帶去旅行用的錢）</label>
              <input
                type="text"
                inputMode="decimal"
                className={inputCls}
                value={toAmount}
                disabled={saving}
                placeholder="例如 700"
                onChange={(e) => onToAmountChange(filterDecimalInput(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="block text-[10.5px] text-slate-400 mb-1">
              換匯匯率（1 {toCurrency || "換入幣別"} ≈ ? {fromCurrency || "換出幣別"}）
              {rateLoading && <span className="ml-1.5 text-slate-400">查詢即時匯率中…</span>}
            </label>
            <input
              type="text"
              inputMode="decimal"
              className={`${inputCls} max-w-[200px]`}
              value={rate}
              disabled={saving}
              placeholder="當初實際換到的匯率"
              onChange={(e) => onRateChange(filterDecimalInput(e.target.value))}
            />
            {rateNotice && <p className="text-[10.5px] text-slate-400 mt-1">{rateNotice}</p>}
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} type="button" disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} type="button" disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** TripAccess.role -> Traditional-Chinese label, per this round's "擁有者／
 * 可編輯／唯讀" simplification (see backend/app/models.py TripAccess's
 * docstring) — replaces the old "協作者" wording, which real-user feedback
 * called out as too vague to tell apart from "viewer". "contributor" (the
 * guest-mode restricted role added by the later "訪客也能是完整成員"
 * simplification round) is display-only here — see `canSwitchRole` below
 * for why it's never a switch target. Falls back to the raw role string for
 * any unexpected value rather than silently showing nothing. */
function roleLabel(role: string): string {
  if (role === "owner") return "擁有者";
  if (role === "viewer") return "唯讀";
  if (role === "editor") return "可編輯";
  if (role === "contributor") return "訪客（僅記帳）";
  return role;
}

/**
 * Turns a thrown value from any lib/api.ts call into copy a non-technical
 * user can actually act on. Two cases:
 *   - ApiError: the backend already wrote a Chinese, human-readable
 *     `detail` (e.g. "擁有者不能移除自己的存取權限") — just use it.
 *   - A raw fetch()-level failure (server unreachable, CORS, DNS, offline —
 *     the browser throws a bare `TypeError` for all of these, message
 *     literally "Failed to fetch" in Chrome/Safari): that string means
 *     nothing to a user, so it's replaced with a plain-language explanation
 *     instead of ever being shown verbatim.
 * `fallback` covers anything else unexpected.
 */
function describeError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof TypeError) return "無法連線到伺服器，請確認網路連線後再試一次";
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

/**
 * "成員" — merges what used to be two separate settings sections
 * (MembersSection's split-accounting Member list + AccessSection's
 * TripAccess/invite-link sharing list) into one screen. Real-user feedback
 * after trying the app was that both read as "the people in this trip" —
 * having two separately-scrolled-to blocks for what feels like one concept
 * was confusing.
 *
 * The underlying data models stay deliberately separate (see
 * backend/app/models.py Member's docstring): a Member is just a name that
 * can be a split participant without ever logging into the app (e.g.
 * tracking a friend's cash contributions who never installs/logs into
 * anything) — that ability is the whole reason Member and User/TripAccess
 * aren't merged into one table. What IS new is Member.user_id, an optional
 * link between the two: create_trip links the creator's auto-added Member,
 * join_trip auto-links (or creates) a Member for whoever redeems an invite
 * code, and link-guest repoints a guest's Member.user_id to their real
 * Google User once they upgrade (see those three backend call sites for the
 * exact write semantics). A Member row with user_id set renders here with a
 * "已連結帳號" badge + that account's real email (pulled from GET
 * /api/trips/{id}/access, joined by user_id) instead of just a plain name;
 * a Member with no user_id renders exactly like the old MembersSection did.
 *
 * "產生邀請連結" (the actual invite-granting mechanism — this is how a
 * unlinked-account person becomes a linked one) lives in the same card,
 * below the member list, exactly where AccessSection used to render it.
 *
 * Owner-only "移除" on a row with a linked account (DELETE
 * /api/trips/{id}/access/{user_id}) now does BOTH at once: revokes login
 * access AND deletes the linked split-Member, in one backend transaction
 * (see backend/app/routers/trips.py remove_trip_access). This used to be
 * two separately-clickable actions ("移除存取權" text button + a separate
 * "X" delete-member button) — real-user feedback was that having "access"
 * and "分帳身分" as two independently-removable things for the same linked
 * person was confusing (you could end up with access-but-no-split-identity
 * or split-identity-but-no-access, neither of which reads as sensible). An
 * unlinked Member (no login at all) keeps its own separate, unchanged
 * "刪除成員" action — it never had "access" to merge in the first place.
 */
export default function PeopleSection({
  trip,
  onChanged,
  bare = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
}) {
  const { showToast } = useToast();

  // ---------- Member list (rename / add / delete) ----------
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const savingIdRef = useRef<number | null>(null);

  // ---------- TripAccess list / invite link ----------
  const [access, setAccess] = useState<TripAccessUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [switchingRoleId, setSwitchingRoleId] = useState<number | null>(null);

  // ---------- Per-member "初始換匯" (see MemberExchangeDialog above) ----------
  const [exchangeMember, setExchangeMember] = useState<Member | null>(null);

  // ---------- Merge member (owner-only "把重複成員合併成一筆" tool — see
  // backend/app/routers/trips.py merge_member) ----------
  const [mergeSource, setMergeSource] = useState<Member | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | "">("");
  const [merging, setMerging] = useState(false);

  const loadAccess = useCallback(() => {
    getTripAccess(trip.id)
      .then((rows) => {
        setAccess(rows);
        setLoadError(null);
      })
      .catch((e) => setLoadError(describeError(e, "載入共用名單失敗，請稍後再試")));
  }, [trip.id]);

  useEffect(loadAccess, [loadAccess]);

  // "am I the owner" — read straight off the backend's own `is_me` flag on
  // each access row (see backend/app/schemas.py TripAccessUserOut / routers/
  // trips.py list_trip_access). Deliberately NOT derived by matching
  // NextAuth's session.user.email against this list: a guest caller has no
  // NextAuth session at all (session?.user?.email is always undefined for
  // them), which used to make isOwner silently false even for a guest who
  // genuinely owns the trip — the backend already knows who's calling via
  // the auth token, so it just tells us directly instead of the frontend
  // re-guessing it.
  const me = access?.find((a) => a.is_me);
  const isOwner = me?.role === "owner";
  // "唯讀" gating — see trip.my_role's own docstring (lib/types.ts) / this
  // round's task spec: a viewer can see this whole list but every add/edit/
  // delete control here is hidden, not just left to fail against the
  // backend's own require_edit_access check after the click.
  const isViewer = trip.my_role === "viewer";

  const accessByUserId = new Map((access ?? []).map((a) => [a.user_id, a]));
  const linkedMemberUserIds = new Set(
    trip.members.map((m) => m.user_id).filter((id): id is number => id != null)
  );
  // Access rows with no matching Member row at all — e.g. a trip invited
  // someone before this round's auto-link existed and they never got
  // backfilled a Member row. Shown as a fallback so nobody with real access
  // silently disappears from this merged view.
  const accessOnlyRows = (access ?? []).filter((a) => !linkedMemberUserIds.has(a.user_id));

  // ---------- Member actions ----------
  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await createMember(trip.id, newName.trim());
      setNewName("");
      onChanged();
      showToast(`已新增成員「${created.name}」`);
    } catch (e) {
      showToast(describeError(e, "新增成員失敗，請稍後再試"), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, name: string) => {
    try {
      await deleteMember(id);
      onChanged();
      showToast(`已刪除成員「${name}」`);
    } catch (e) {
      showToast(describeError(e, "刪除成員失敗（可能已有支出紀錄使用此成員）"), "error");
    }
  };

  const startEdit = (m: Member) => {
    setEditingId(m.id);
    setEditName(m.name);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };
  const commitEdit = async (id: number, originalName: string) => {
    if (savingIdRef.current === id) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === originalName) {
      cancelEdit();
      return;
    }
    savingIdRef.current = id;
    try {
      await updateMember(id, trimmed);
      onChanged();
      showToast(`已更新成員名稱為「${trimmed}」`);
    } catch (e) {
      showToast(describeError(e, "更新成員失敗，請稍後再試"), "error");
    } finally {
      savingIdRef.current = null;
      cancelEdit();
    }
  };

  // ---------- Merge actions ----------
  // Only members WITHOUT a linked account may be the merge source — mirrors
  // the backend's merge-direction rule (see routers/trips.py merge_member's
  // docstring): merging always risks losing the SOURCE's data if it turns
  // out to hold something the target doesn't, and a linked account has no
  // backup copy of that link anywhere else, so the "合併" action is only
  // offered on unlinked rows in the first place — never on a row the
  // backend would reject anyway.
  const openMerge = (m: Member) => {
    setMergeSource(m);
    setMergeTargetId("");
  };
  const closeMerge = () => {
    setMergeSource(null);
    setMergeTargetId("");
  };
  const confirmMerge = async () => {
    if (!mergeSource || mergeTargetId === "") return;
    setMerging(true);
    try {
      const target = await mergeMember(trip.id, mergeSource.id, mergeTargetId);
      onChanged();
      showToast(`已將「${mergeSource.name}」合併進「${target.name}」`);
      closeMerge();
    } catch (e) {
      showToast(describeError(e, "合併失敗，請稍後再試"), "error");
    } finally {
      setMerging(false);
    }
  };

  // ---------- Access actions ----------
  const generateInvite = async () => {
    setGenerating(true);
    try {
      const { invite_code } = await createInvite(trip.id);
      setInviteLink(`${window.location.origin}/join/${invite_code}`);
      setCopied(false);
    } catch (e) {
      showToast(describeError(e, "產生邀請連結失敗，請稍後再試"), "error");
    } finally {
      setGenerating(false);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      showToast("邀請連結已複製");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("複製失敗，請手動選取連結", "error");
    }
  };

  const removeAccess = async (userId: number, name: string) => {
    setRemovingId(userId);
    try {
      await removeTripAccess(trip.id, userId);
      loadAccess();
      onChanged();
      showToast(`已移除「${name}」——存取權限與分帳身分已一併移除`);
    } catch (e) {
      showToast(describeError(e, "移除失敗，請稍後再試"), "error");
    } finally {
      setRemovingId(null);
    }
  };

  // ---------- Role switch (owner-only "可編輯" <-> "唯讀" toggle) ----------
  const switchRole = async (userId: number, name: string, nextRole: "editor" | "viewer") => {
    setSwitchingRoleId(userId);
    try {
      await updateTripAccessRole(trip.id, userId, nextRole);
      loadAccess();
      showToast(`已將「${name}」的權限改為「${roleLabel(nextRole)}」`);
    } catch (e) {
      showToast(describeError(e, "變更權限失敗，請稍後再試"), "error");
    } finally {
      setSwitchingRoleId(null);
    }
  };

  const Wrapper = bare ? "div" : Card;
  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";

  return (
    <Wrapper id="section-members">
      {!bare && <p className="text-sm md:text-base font-semibold text-slate-900 mb-3">成員</p>}
      <p className="text-xs text-slate-500 mb-3">
        這趟行程裡分帳用的成員清單——有些人只是名字（不需要登入也能分攤支出），有些人已經用 Google／訪客帳號登入並加入了這趟行程。
      </p>

      {loadError && <p className="text-sm text-rose-600 mb-3">{loadError}</p>}

      <div>
        {trip.members.map((m) => {
          const linkedAccess = m.user_id != null ? accessByUserId.get(m.user_id) : undefined;
          const canSwitchRole = isOwner && linkedAccess && linkedAccess.role !== "owner" && !linkedAccess.is_me;
          // "只有本人能管理自己的換匯" (this round's rule, tightened; mirrors
          // backend routers/members.py update_member's ownership check): a
          // Member's exchange record may ONLY be edited by that same linked
          // account (me?.user_id, from the backend's own `is_me` flag — see
          // the `me`/`isOwner` comment above). A Member with no linked
          // account (m.user_id == null — just a typed-in name, nobody to log
          // in as "them") used to let any editor/owner fill it in on their
          // behalf, but that exception is gone — with no linked account,
          // nobody (not even the owner) may edit it until the member links
          // one.
          const canEditOwnExchange = m.user_id != null && m.user_id === me?.user_id;
          return (
            <div key={m.id} className="flex items-center gap-2.5 py-2 border-b border-slate-100 last:border-b-0">
              <Avatar name={m.name} color={m.color} avatarUrl={m.avatar_url} size="sm" />
              <div className="flex-1 min-w-0">
                {editingId === m.id ? (
                  <input
                    autoFocus
                    className="w-full border border-teal-400 rounded px-1.5 py-1 text-[13.5px] outline-none"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => commitEdit(m.id, m.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(m.id, m.name);
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                ) : isViewer ? (
                  <span className="text-[13.5px] text-slate-800 truncate max-w-full inline-block">{m.name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    title="點擊編輯姓名"
                    className="text-[13.5px] text-slate-800 text-left hover:text-teal-700 hover:underline truncate max-w-full"
                  >
                    {m.name}
                  </button>
                )}
                {linkedAccess && (
                  <p className="text-[11px] text-teal-600 truncate">已連結帳號・{linkedAccess.email}</p>
                )}
              </div>
              {/* Role badge/switcher — TripAccess.role only ("擁有者"/"可編輯"
                  /"唯讀"), never "成員": that word is already used elsewhere
                  on this screen to mean "in the split list", a completely
                  different concept from login role (see this file's top
                  docstring / task spec). Kept visually separate from the
                  "已連結帳號" line below the name, which is about account
                  linkage, not role. Owner sees a live <select> for every
                  other linked row (switches "可編輯"<->"唯讀"); everyone else
                  (incl. the owner's own row) just sees the plain badge. */}
              {m.user_id != null && !canSwitchRole && (
                <span
                  className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold shrink-0 ${
                    linkedAccess?.role === "owner" ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {linkedAccess ? roleLabel(linkedAccess.role) : ""}
                </span>
              )}
              {canSwitchRole && linkedAccess && (
                <Select
                  className="hidden sm:block w-[84px] shrink-0"
                  buttonClassName="rounded-full !border-slate-200 bg-slate-100 !text-slate-600 font-semibold"
                  size="sm"
                  value={linkedAccess.role === "viewer" ? "viewer" : "editor"}
                  disabled={switchingRoleId === linkedAccess.user_id}
                  onChange={(v) => switchRole(linkedAccess.user_id, m.name, v as "editor" | "viewer")}
                  options={[
                    { value: "editor", label: "可編輯" },
                    { value: "viewer", label: "唯讀" },
                  ]}
                />
              )}
              {!isViewer && canEditOwnExchange && (
                <button
                  type="button"
                  onClick={() => setExchangeMember(m)}
                  title="初始換匯紀錄"
                  className="text-slate-400 hover:text-teal-600 text-[11px] font-medium shrink-0 inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Wallet size={12} aria-hidden="true" />
                  <span className="hidden sm:inline">換匯</span>
                </button>
              )}
              {/* Read-only stand-in for any Member row the caller can't edit
                  the exchange record of — either a linked Member that ISN'T
                  the caller's own account, or an unlinked Member (nobody to
                  defer to at all, see canEditOwnExchange's comment above).
                  Same icon/label as the editable button above so the row's
                  layout doesn't jump, but disabled with a tooltip explaining
                  why (backend routers/members.py update_member 403s both of
                  these same cases server-side regardless). */}
              {!isViewer && !canEditOwnExchange && (
                <button
                  type="button"
                  disabled
                  title={m.user_id == null ? "這位成員沒有連結帳號，無法記錄換匯" : "只有本人能編輯自己的初始換匯紀錄"}
                  aria-label={m.user_id == null ? "這位成員沒有連結帳號，無法記錄換匯" : "只有本人能編輯自己的初始換匯紀錄"}
                  className="text-slate-300 text-[11px] font-medium shrink-0 inline-flex items-center gap-1 whitespace-nowrap cursor-not-allowed"
                >
                  <Wallet size={12} aria-hidden="true" />
                  <span className="hidden sm:inline">換匯</span>
                </button>
              )}
              {isOwner && m.user_id == null && trip.members.length > 1 && (
                <button
                  type="button"
                  onClick={() => openMerge(m)}
                  title="合併到其他成員"
                  className="text-slate-400 hover:text-teal-600 text-[11px] font-medium shrink-0 inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <GitMerge size={12} aria-hidden="true" />
                  <span className="hidden sm:inline">合併</span>
                </button>
              )}
              {/* Merged action: for a linked-account row, this ONE button
                  removes both login access and the split-Member identity
                  together (see removeAccess above / backend
                  remove_trip_access) — no longer two separate buttons. An
                  unlinked (no login) row keeps the original, separate
                  "刪除成員" action, which is about the split list only and
                  has nothing to do with access. */}
              {linkedAccess && isOwner && (
                <ConfirmButton
                  message={`確定要移除「${m.name}」嗎？這會同時移除他的存取權限跟分帳資料——他將無法再登入查看這趟行程，這位分帳成員也會一併從名單中消失。`}
                  onConfirm={() => removeAccess(linkedAccess.user_id, m.name)}
                  disabled={linkedAccess.is_me}
                  title={linkedAccess.is_me ? "擁有者無法移除自己的存取權" : "移除存取權限與分帳身分"}
                  className="text-slate-400 hover:text-rose-600 text-sm inline-flex items-center shrink-0 disabled:opacity-40 disabled:hover:text-slate-400"
                >
                  {removingId === linkedAccess.user_id ? (
                    <span className="text-[11px]">移除中…</span>
                  ) : (
                    <Trash2 size={14} aria-hidden="true" />
                  )}
                </ConfirmButton>
              )}
              {!linkedAccess && !isViewer && (
                <ConfirmButton
                  message={`確定要移除成員「${m.name}」嗎？若此成員已被支出使用，刪除將會失敗。`}
                  onConfirm={() => remove(m.id, m.name)}
                  className="text-slate-400 hover:text-rose-600 text-sm inline-flex items-center shrink-0"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </ConfirmButton>
              )}
            </div>
          );
        })}
        {trip.members.length === 0 && <p className="text-sm text-slate-400 py-2">尚未新增成員</p>}

        {accessOnlyRows.map((a) => {
          // "contributor" (guest — this round's "訪客也能是完整成員"
          // simplification) is excluded from the switchable set too: it's
          // never a manually-assignable role (only join_trip's is_guest
          // branch produces it — see backend TripAccessRoleUpdate's
          // Literal["editor", "viewer"], which already rejects switching
          // ANYONE into "contributor" at the request-validation layer), and
          // switching a contributor OUT of it via this "可編輯"/"唯讀"
          // selector isn't a flow this round's task spec asks for either —
          // just show the plain badge for a contributor row.
          const canSwitchRole = isOwner && a.role !== "owner" && a.role !== "contributor" && !a.is_me;
          // A "contributor" row is always a guest (see backend routers/
          // trips.py join_trip's docstring: only a guest joiner ever lands
          // as "contributor", and a guest is deliberately NEVER linked to a
          // Member row) — so for this role, "no linked Member" isn't leftover
          // abnormal data, it's the permanent, by-design state. Two things
          // follow: (1) `a.email` here is never a real address a human typed
          // in, it's User.is_guest's synthetic "guest-<uuid>@guest.local"
          // placeholder (see models.py User's docstring) — meaningless to
          // show; (2) the amber "尚未加入分帳" warning below is for flagging
          // an unexpected state, which this isn't, so it's skipped for
          // contributor rows entirely.
          const isGuestContributor = a.role === "contributor";
          return (
            <div key={`access-${a.user_id}`} className="flex items-center gap-2.5 py-2 border-b border-slate-100 last:border-b-0">
              <Avatar name={a.name} color="#94a3b8" avatarUrl={a.avatar_url} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] text-slate-800 truncate">{a.name}</p>
                {!isGuestContributor && <p className="text-[11px] text-slate-400 truncate">{a.email}</p>}
              </div>
              {/* "是否加入分帳" fallback badge — see this file's top docstring:
                  after this round's merge, this row shape (has access, no
                  linked Member) should no longer occur in normal use for a
                  non-guest (create_trip / join_trip always auto-link a
                  Member for a Google user), so it's kept purely as a
                  defensive display for that leftover-old-data case. A guest
                  "contributor" row ALSO always has no linked Member, but by
                  design (see isGuestContributor above) — not a state worth
                  warning about, so it's excluded here. */}
              {!isGuestContributor && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 sm:px-2 py-0.5 text-[10.5px] font-medium text-amber-700 bg-amber-50 border border-amber-200 shrink-0"
                  title="這位使用者有這趟行程的存取權限，但還沒被加進分帳成員名單"
                >
                  <UserX size={11} aria-hidden="true" />
                  <span className="hidden sm:inline">尚未加入分帳</span>
                </span>
              )}
              {/* Role badge/switcher — same "擁有者"/"可編輯"/"唯讀" wording
                  and owner-only <select> as the trip.members rows above. */}
              {!canSwitchRole && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${
                    a.role === "owner" ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {roleLabel(a.role)}
                </span>
              )}
              {canSwitchRole && (
                <Select
                  className="w-[92px] shrink-0"
                  buttonClassName="rounded-full !border-slate-200 bg-slate-100 !text-slate-600 font-semibold"
                  size="sm"
                  value={a.role === "viewer" ? "viewer" : "editor"}
                  disabled={switchingRoleId === a.user_id}
                  onChange={(v) => switchRole(a.user_id, a.name, v as "editor" | "viewer")}
                  options={[
                    { value: "editor", label: "可編輯" },
                    { value: "viewer", label: "唯讀" },
                  ]}
                />
              )}
              {isOwner && (
                <ConfirmButton
                  message={`確定要移除「${a.name}」嗎？這會同時移除他的存取權限跟分帳資料。`}
                  onConfirm={() => removeAccess(a.user_id, a.name)}
                  disabled={a.is_me}
                  title={a.is_me ? "擁有者無法移除自己的存取權" : "移除存取權限與分帳身分"}
                  className="text-slate-400 hover:text-rose-600 text-sm inline-flex items-center shrink-0 disabled:opacity-40 disabled:hover:text-slate-400"
                >
                  {removingId === a.user_id ? <span className="text-[11px]">移除中…</span> : <Trash2 size={14} aria-hidden="true" />}
                </ConfirmButton>
              )}
            </div>
          );
        })}
      </div>

      {!isViewer && (
        <div className="flex gap-2 mt-2.5">
          <input
            className={inputCls}
            placeholder="輸入成員姓名…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button
            onClick={add}
            disabled={busy}
            className="border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            ＋ 新增成員
          </button>
        </div>
      )}

      {isOwner && (
        <div className="border-t border-slate-100 pt-3.5 mt-3.5">
          <p className="text-xs text-slate-500 mb-2.5">
            邀請其他人一起記帳——產生連結後分享出去，對方登入後打開連結即可加入這趟行程，並自動成為分帳成員。
          </p>
          <Button variant="outline-dashed" onClick={generateInvite} disabled={generating}>
            <span className="inline-flex items-center gap-1">
              <LinkIcon size={13} aria-hidden="true" />
              {generating ? "產生中…" : "產生邀請連結"}
            </span>
          </Button>
          {inviteLink && (
            <div className="mt-2.5 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 min-w-0 bg-transparent text-[12.5px] text-slate-600 outline-none"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={copyInviteLink}
                className="shrink-0 text-teal-600 hover:text-teal-700 text-xs font-semibold inline-flex items-center gap-1"
              >
                <Copy size={13} aria-hidden="true" />
                {copied ? "已複製" : "複製"}
              </button>
            </div>
          )}
        </div>
      )}

      <Dialog open={mergeSource != null} onClose={closeMerge} title="合併成員" subtitle={mergeSource ? `把「${mergeSource.name}」合併到...` : undefined}>
        {mergeSource && (
          <div className="space-y-4">
            <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 leading-relaxed">
              這是不可逆的動作：合併後「{mergeSource.name}」會被刪除，這位成員所有的支出紀錄（包含付款人、分帳份額）都會轉移到你選擇的目標成員身上。若目標成員在同一筆支出裡本來就有自己的份額，兩筆份額會加總合併成一筆。
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">合併到（目標成員）</label>
              <Select
                value={mergeTargetId === "" ? "" : String(mergeTargetId)}
                onChange={(v) => setMergeTargetId(v ? Number(v) : "")}
                placeholder="請選擇..."
                options={trip.members
                  .filter((m) => m.id !== mergeSource.id)
                  .map((m) => ({
                    value: String(m.id),
                    label: `${m.name}${m.user_id != null ? "（已連結帳號）" : ""}`,
                  }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={closeMerge} type="button" disabled={merging}>
                取消
              </Button>
              <Button variant="danger" onClick={confirmMerge} type="button" disabled={merging || mergeTargetId === ""}>
                {merging ? "合併中…" : "確定合併"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {exchangeMember && (
        <MemberExchangeDialog
          member={exchangeMember}
          open={exchangeMember != null}
          onClose={() => setExchangeMember(null)}
          onSaved={onChanged}
        />
      )}
    </Wrapper>
  );
}
