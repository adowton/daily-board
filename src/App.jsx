import { useState, useEffect, useRef } from "react";
import {
  Plus, X, Trash2, ChevronLeft, ChevronRight, ChevronDown, Check, Clock,
  Circle, Pencil, RotateCcw, PlayCircle, ArrowUp, ArrowDown, Loader2, Flag, ListChecks, Zap, Flame, Star
} from "lucide-react";

const API = "/.netlify/functions/board";

async function apiCall(body) {
  const res = await fetch(API, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}
async function apiLoad() {
  const res = await fetch(API, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

const ALL_ID = "__all__";

const STATUS_ORDER = ["todo", "waiting", "done"];
const STATUS_META = {
  todo:    { label: "To do",    varColor: "var(--c-todo)",    textColor: "var(--c-todo-text)" },
  waiting: { label: "Waiting",  varColor: "var(--c-waiting)", textColor: "var(--c-waiting-text)" },
  done:    { label: "Done",     varColor: "var(--c-done)",    textColor: "var(--c-done-text)" },
};

const HEALTH_ORDER = ["green", "yellow", "black"];
const HEALTH_META = {
  green:  { label: "On track",       varColor: "var(--c-health-green)" },
  yellow: { label: "Needs caution",  varColor: "var(--c-health-yellow)" },
  black:  { label: "Needs attention", varColor: "var(--c-health-black)" },
};

const EFFORT_META = {
  quick: { label: "Quick & easy", varColor: "var(--c-quick)" },
  high:  { label: "High impact",  varColor: "var(--c-high)" },
};


export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activeCat, setActiveCat] = useState(ALL_ID);
  const [activeSub, setActiveSub] = useState(null);
  const [mode, setMode] = useState("board");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [editingCats, setEditingCats] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newSubName, setNewSubName] = useState({});
  const [newTaskText, setNewTaskText] = useState("");
  const [reviewInputs, setReviewInputs] = useState({});
  const saveStateRef = useRef("idle");
  useEffect(() => { saveStateRef.current = saveState; }, [saveState]);

  // All mutations go through this instead of calling apiCall directly, so
  // saveState reflects "saving" for the whole round trip. That's what stops
  // the 12s background refresh from landing mid-write and clobbering a click
  // with stale data (the bug where effort tags reverted after a refresh).
  function trackedApiCall(body) {
    setSaveState("saving");
    return apiCall(body)
      .then((res) => { setSaveState("idle"); return res; })
      .catch((e) => { console.error(e); setSaveState("error"); throw e; });
  }

  async function loadBoard() {
    try {
      const data = await apiLoad();
      const cats = (data.categories && data.categories.length ? data.categories : []).map((c) => ({ priorityTaskId: null, ...c }));
      const cleanSubs = (data.subcategories || []).map((s) => ({ health: "green", ...s }));
      const cleanTasks = (data.tasks || []).map((t) => ({ effort: null, completedAt: null, ...t }));
      setCategories(cats);
      setSubcategories(cleanSubs);
      setTasks(cleanTasks);
      setSaveState("idle");
    } catch (e) {
      console.error("Airtable load failed:", e);
      setSaveState("error");
    } finally {
      setLoaded(true);
    }
  }

  // Initial load, then poll every 12s so a second device's changes show up here too.
  // (Airtable has no realtime push like Firestore, so this is the simplest stand-in.)
  useEffect(() => {
    loadBoard();
    const interval = setInterval(() => {
      if (saveStateRef.current !== "saving") loadBoard();
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const subsOf = (catId) => subcategories.filter((s) => s.categoryId === catId);
  const openTasksForCategory = (catId) => tasks.filter((t) => t.categoryId === catId && t.status !== "done");
  const openTasksForSub = (subId) => tasks.filter((t) => t.subcategoryId === subId && t.status !== "done");
  const allTasksForSub = (subId) => tasks.filter((t) => t.subcategoryId === subId);

  async function addCategory() {
    const name = newCatName.trim();
    if (!name) return;
    setNewCatName("");
    try {
      const order = categories.length;
      const { id } = await trackedApiCall({ table: "categories", op: "create", fields: { name, order } });
      const cat = { id, name, priorityTaskId: null, order };
      setCategories((prev) => [...prev, cat]);
      setActiveCat(id);
      setActiveSub(null);
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  }
  function renameCategory(id, name) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    trackedApiCall({ table: "categories", op: "update", id, fields: { name } }).catch((e) => { console.error(e); setSaveState("error"); });
  }
  function deleteCategory(id) {
    const remaining = categories.filter((c) => c.id !== id);
    const subIds = subcategories.filter((s) => s.categoryId === id).map((s) => s.id);
    const taskIds = tasks.filter((t) => t.categoryId === id || subIds.includes(t.subcategoryId)).map((t) => t.id);
    setCategories(remaining);
    setSubcategories((prev) => prev.filter((s) => s.categoryId !== id));
    setTasks((prev) => prev.filter((t) => t.categoryId !== id && !subIds.includes(t.subcategoryId)));
    if (activeCat === id) { setActiveCat(ALL_ID); setActiveSub(null); }
    // Best-effort cascade: tasks and projects under this category get cleaned up too.
    Promise.all([
      ...taskIds.map((tid) => trackedApiCall({ table: "tasks", op: "delete", id: tid })),
      ...subIds.map((sid) => trackedApiCall({ table: "projects", op: "delete", id: sid })),
      trackedApiCall({ table: "categories", op: "delete", id }),
    ]).catch((e) => { console.error(e); setSaveState("error"); });
  }
  function moveCategory(id, dir) {
    setCategories((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      const reindexed = copy.map((c, i) => ({ ...c, order: i }));
      Promise.all(reindexed.map((c) => trackedApiCall({ table: "categories", op: "update", id: c.id, fields: { order: c.order } })))
        .catch((e) => { console.error(e); setSaveState("error"); });
      return reindexed;
    });
  }

  async function addSubcategory(catId) {
    const name = (newSubName[catId] || "").trim();
    if (!name) return;
    setNewSubName((prev) => ({ ...prev, [catId]: "" }));
    try {
      const { id } = await trackedApiCall({ table: "projects", op: "create", fields: { name, categoryId: catId, health: "green" } });
      setSubcategories((prev) => [...prev, { id, categoryId: catId, name, health: "green" }]);
      setActiveCat(catId);
      setActiveSub(id);
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  }
  function cycleHealth(subId) {
    const sub = subcategories.find((s) => s.id === subId);
    if (!sub) return;
    const idx = HEALTH_ORDER.indexOf(sub.health || "green");
    const nextHealth = HEALTH_ORDER[(idx + 1) % HEALTH_ORDER.length];
    setSubcategories((prev) => prev.map((s) => (s.id === subId ? { ...s, health: nextHealth } : s)));
    trackedApiCall({ table: "projects", op: "update", id: subId, fields: { health: nextHealth } }).catch((e) => { console.error(e); setSaveState("error"); });
  }
  function deleteSubcategory(id) {
    const taskIds = tasks.filter((t) => t.subcategoryId === id).map((t) => t.id);
    setSubcategories((prev) => prev.filter((s) => s.id !== id));
    setTasks((prev) => prev.filter((t) => t.subcategoryId !== id));
    if (activeSub === id) setActiveSub(null);
    Promise.all([
      ...taskIds.map((tid) => trackedApiCall({ table: "tasks", op: "delete", id: tid })),
      trackedApiCall({ table: "projects", op: "delete", id }),
    ]).catch((e) => { console.error(e); setSaveState("error"); });
  }

  async function addTask(catId, subId, text) {
    const t = text.trim();
    if (!t || !catId || catId === ALL_ID) return;
    try {
      const { id } = await trackedApiCall({ table: "tasks", op: "create", fields: { text: t, status: "todo", effort: null, categoryId: catId, subcategoryId: subId || null } });
      setTasks((prev) => [...prev, { id, categoryId: catId, subcategoryId: subId || null, text: t, status: "todo", effort: null, completedAt: null, createdAt: Date.now() }]);
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  }
  function setEffort(taskId, value) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const nextEffort = task.effort === value ? null : value;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, effort: nextEffort } : t)));
    trackedApiCall({ table: "tasks", op: "update", id: taskId, fields: { effort: nextEffort } }).catch((e) => { console.error(e); setSaveState("error"); });
  }
  function cycleStatus(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const idx = STATUS_ORDER.indexOf(task.status);
    const nextStatus = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    const nextCompletedAt = nextStatus === "done" ? Date.now() : null;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus, completedAt: nextCompletedAt } : t)));
    trackedApiCall({ table: "tasks", op: "update", id: taskId, fields: { status: nextStatus, completedAt: nextCompletedAt } }).catch((e) => { console.error(e); setSaveState("error"); });
    if (nextStatus === "done") {
      const clearedCat = categories.find((c) => c.priorityTaskId === taskId);
      if (clearedCat) {
        setCategories((prev) => prev.map((c) => (c.priorityTaskId === taskId ? { ...c, priorityTaskId: null } : c)));
        trackedApiCall({ table: "categories", op: "update", id: clearedCat.id, fields: { priorityTaskId: null } }).catch((e) => console.error(e));
      }
    }
  }
  function deleteTask(taskId) {
    const clearedCat = categories.find((c) => c.priorityTaskId === taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setCategories((prev) => prev.map((c) => (c.priorityTaskId === taskId ? { ...c, priorityTaskId: null } : c)));
    trackedApiCall({ table: "tasks", op: "delete", id: taskId }).catch((e) => { console.error(e); setSaveState("error"); });
    if (clearedCat) trackedApiCall({ table: "categories", op: "update", id: clearedCat.id, fields: { priorityTaskId: null } }).catch((e) => console.error(e));
  }
  function togglePriority(catId, taskId) {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return;
    const nextPriority = cat.priorityTaskId === taskId ? null : taskId;
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, priorityTaskId: nextPriority } : c)));
    trackedApiCall({ table: "categories", op: "update", id: catId, fields: { priorityTaskId: nextPriority } }).catch((e) => { console.error(e); setSaveState("error"); });
  }
  function clearDoneInScope() {
    let idsToDelete = [];
    if (activeSub) {
      idsToDelete = tasks.filter((t) => t.subcategoryId === activeSub && t.status === "done").map((t) => t.id);
      setTasks((prev) => prev.filter((t) => !(t.subcategoryId === activeSub && t.status === "done")));
    } else if (activeCat && activeCat !== ALL_ID) {
      idsToDelete = tasks.filter((t) => t.categoryId === activeCat && t.status === "done").map((t) => t.id);
      setTasks((prev) => prev.filter((t) => !(t.categoryId === activeCat && t.status === "done")));
    }
    Promise.all(idsToDelete.map((id) => trackedApiCall({ table: "tasks", op: "delete", id }))).catch((e) => { console.error(e); setSaveState("error"); });
  }

  function startReview() { setMode("review"); setReviewIndex(0); }
  function endReview() { setMode("board"); }

  const activeCategory = activeCat === ALL_ID ? null : categories.find((c) => c.id === activeCat) || null;
  const activeSubcat = subcategories.find((s) => s.id === activeSub) || null;
  const totalOpen = tasks.filter((t) => t.status !== "done").length;
  const todayCompletedCount = tasks.filter((t) => {
    if (t.status !== "done" || !t.completedAt) return false;
    const d = new Date(t.completedAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;

  const priorityTasks = categories
    .map((c) => (c.priorityTaskId ? { cat: c, task: tasks.find((t) => t.id === c.priorityTaskId) } : null))
    .filter((x) => x && x.task);

  const reviewSteps = categories.flatMap((cat) => {
    const subs = subsOf(cat.id);
    const catStep = { key: cat.id, cat, sub: null, label: cat.name, breadcrumb: null };
    const subSteps = subs.map((sub) => ({ key: sub.id, cat, sub, label: sub.name, breadcrumb: cat.name }));
    return [catStep, ...subSteps];
  });

  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#8b8f98", fontFamily: "Inter, sans-serif" }}>
        <Loader2 size={18} style={{ marginRight: 8, animation: "spin 1s linear infinite" }} />
        Loading your board…
      </div>
    );
  }

  const targetLabel = activeSubcat ? activeSubcat.name : activeCategory ? activeCategory.name : "";

  return (
    <div className="board-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        .board-root {
          --c-bg: #EEF0F3;
          --c-surface: #FFFFFF;
          --c-ink: #14161A;
          --c-ink-soft: #4A4E57;
          --c-muted: #8B8F98;
          --c-line: #E4E6EA;
          --c-accent: #4F46E5;
          --c-accent-soft: #EDEBFC;
          --c-priority: #E5484D;
          --c-priority-soft: #FCE9E9;

          --c-todo: #14161A;
          --c-todo-text: #FFFFFF;
          --c-waiting: #FFC53D;
          --c-waiting-text: #1F1400;
          --c-waiting-soft: #FFF6DC;
          --c-done: #BBF7D0;
          --c-done-text: #14532D;

          --c-health-green: #22C55E;
          --c-health-yellow: #FFC53D;
          --c-health-black: #14161A;

          --c-quick: #0EA5A5;
          --c-quick-soft: #E3F7F7;
          --c-high: #7C3AED;
          --c-high-soft: #F1EBFD;

          --c-progress-blue: #7DD3FC;
          --c-progress-green: #22C55E;

          font-family: 'Inter', sans-serif;
          color: var(--c-ink);
          background: var(--c-bg);
          width: 100%;
          height: 100%;
          max-width: none;
          margin: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .board-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--c-line); background: var(--c-surface); }

        .day-progress-bar {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 11.5px;
          font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
          transition: background-color 0.3s ease;
        }
        .board-title { font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; }
        .board-subtitle { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--c-muted); margin-top: 1px; }
        .save-indicator { font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-muted); }
        .save-indicator.error { color: var(--c-priority); }
        .review-btn { display: flex; align-items: center; gap: 6px; background: var(--c-accent); color: #fff; border: none; border-radius: 9px; padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .review-btn:hover { background: #4338CA; }
        .review-btn.exit { background: var(--c-ink); }
        .review-btn.exit:hover { background: #000; }

        .board-body { display: flex; flex: 1; min-height: 0; background: var(--c-bg); }

        .tab-rail { width: 236px; flex-shrink: 0; padding: 14px 10px 14px 12px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; }

        .all-tab { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; cursor: pointer; font-size: 13.5px; font-weight: 700; color: var(--c-ink-soft); margin-bottom: 10px; }
        .all-tab:hover { background: rgba(20,22,26,0.05); }
        .all-tab.active { background: var(--c-ink); color: #fff; }
        .all-tab-count { margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; opacity: 0.8; }

        .cat-block { margin-bottom: 2px; }
        .tab { display: flex; align-items: center; gap: 7px; padding: 9px 10px; border-radius: 9px; cursor: pointer; font-size: 13.5px; font-weight: 500; color: var(--c-ink-soft); }
        .tab:hover { background: rgba(20,22,26,0.05); }
        .tab.active { background: var(--c-surface); color: var(--c-ink); font-weight: 600; box-shadow: 0 1px 2px rgba(16,17,20,0.06); }
        .tab-chevron { color: var(--c-muted); display: flex; flex-shrink: 0; transition: transform 0.15s; }
        .tab-chevron.closed { transform: rotate(-90deg); }
        .tab-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tab-count { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--c-muted); min-width: 14px; text-align: right; }
        .tab-count.zero { visibility: hidden; }
        .priority-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c-priority); flex-shrink: 0; }

        .sub-list { padding: 2px 0 6px 20px; display: flex; flex-direction: column; gap: 1px; }
        .sub-tab { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 7px; cursor: pointer; font-size: 12.5px; color: var(--c-ink-soft); }
        .sub-tab:hover { background: rgba(20,22,26,0.05); }
        .sub-tab:hover .sub-del { opacity: 1; }
        .sub-tab.active { background: var(--c-surface); color: var(--c-ink); font-weight: 600; }
        .sub-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sub-count { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--c-muted); }
        .sub-del { opacity: 0; background: none; border: none; color: var(--c-muted); cursor: pointer; display: flex; padding: 2px; }
        .sub-del:hover { color: var(--c-priority); }
        .health-dot { width: 9px; height: 9px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0; padding: 0; }

        .add-sub-row { display: flex; gap: 4px; padding: 3px 8px 6px 8px; }
        .add-sub-row input { flex: 1; font-size: 12px; border: 1px dashed var(--c-line); border-radius: 7px; padding: 5px 7px; background: transparent; font-family: 'Inter', sans-serif; color: var(--c-ink); }
        .add-sub-row button { background: none; border: none; color: var(--c-muted); cursor: pointer; display: flex; align-items: center; padding: 2px 4px; }
        .add-sub-row button:hover { color: var(--c-ink); }

        .cat-edit-row { display: flex; align-items: center; gap: 4px; padding: 4px 6px; }
        .cat-edit-row input { flex: 1; font-size: 12.5px; border: 1px solid var(--c-line); border-radius: 7px; padding: 4px 6px; background: var(--c-surface); color: var(--c-ink); font-family: 'Inter', sans-serif; }
        .icon-btn { background: none; border: none; color: var(--c-muted); cursor: pointer; display: flex; align-items: center; padding: 3px; border-radius: 5px; }
        .icon-btn:hover { color: var(--c-ink); background: rgba(20,22,26,0.06); }
        .icon-btn.danger:hover { color: var(--c-priority); }

        .add-cat-row { display: flex; gap: 6px; padding: 8px 6px 0 6px; }
        .add-cat-row input { flex: 1; font-size: 12.5px; border: 1px dashed var(--c-line); border-radius: 7px; padding: 6px 8px; background: transparent; font-family: 'Inter', sans-serif; color: var(--c-ink); }
        .add-cat-row button { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 7px; padding: 0 8px; cursor: pointer; color: var(--c-ink-soft); display: flex; align-items: center; }

        .rail-footer { padding: 10px 6px 0 6px; }
        .edit-toggle { background: none; border: none; color: var(--c-muted); font-size: 11.5px; cursor: pointer; display: flex; align-items: center; gap: 5px; padding: 4px 0; }
        .edit-toggle:hover { color: var(--c-ink); }

        .panel { flex: 1; background: var(--c-surface); padding: 18px 24px 22px 24px; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow-y: auto; }

        .add-task-bar { display: flex; gap: 8px; margin-bottom: 18px; }
        .add-task-bar input { flex: 1; border: 1px solid var(--c-line); border-radius: 10px; padding: 11px 13px; font-size: 13.5px; font-family: 'Inter', sans-serif; background: var(--c-bg); color: var(--c-ink); }
        .add-task-bar input:focus { outline: 2px solid var(--c-accent-soft); outline-offset: 1px; border-color: var(--c-accent); }
        .add-task-bar button { background: var(--c-ink); color: #fff; border: none; border-radius: 10px; padding: 0 16px; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; }
        .add-task-bar button:hover { background: #000; }

        .section-label { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-muted); margin: 4px 0 6px 0; }
        .group-header { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-muted); margin: 16px 0 4px 0; }

        .empty-state { display: flex; align-items: center; gap: 8px; color: var(--c-muted); font-size: 13.5px; padding: 10px 0; font-style: italic; }

        .task-row { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 9px; }
        .task-row.status-waiting { background: var(--c-waiting-soft); }
        .task-row.priority { background: var(--c-priority-soft); }
        .flag-btn { background: none; border: none; cursor: pointer; display: flex; align-items: center; color: var(--c-line); flex-shrink: 0; }
        .flag-btn.active { color: var(--c-priority); }
        .flag-btn:hover { color: var(--c-priority); }
        .task-tag { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--c-muted); background: var(--c-bg); border-radius: 5px; padding: 2px 6px; flex-shrink: 0; }

        .status-pill { display: flex; align-items: center; gap: 5px; border: none; border-radius: 20px; padding: 4px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; font-weight: 600; cursor: pointer; flex-shrink: 0; background: var(--pill-color); color: var(--pill-text); }
        .task-text { flex: 1; font-size: 13.5px; line-height: 1.4; }
        .task-text.done { color: var(--c-muted); text-decoration: line-through; }
        .clear-done-btn { background: none; border: none; color: var(--c-muted); font-size: 11px; cursor: pointer; margin-top: 12px; display: flex; align-items: center; gap: 4px; align-self: flex-start; }
        .clear-done-btn:hover { color: var(--c-priority); }

        .effort-btn { display: flex; align-items: center; border: 1px solid var(--c-line); border-radius: 7px; background: var(--c-surface); color: var(--c-line); cursor: pointer; padding: 4px; flex-shrink: 0; }
        .effort-btn.quick.active { color: var(--c-quick); border-color: var(--c-quick); background: var(--c-quick-soft); }
        .effort-btn.high.active { color: var(--c-high); border-color: var(--c-high); background: var(--c-high-soft); }
        .effort-btn:not(.active) { color: var(--c-muted); }
        .effort-btn:hover { opacity: 0.85; }

        .filter-row { display: flex; gap: 6px; margin-bottom: 16px; }
        .filter-chip { border: 1px solid var(--c-line); background: var(--c-surface); color: var(--c-ink-soft); border-radius: 20px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .filter-chip.active { background: var(--c-ink); border-color: var(--c-ink); color: #fff; }
        .filter-chip.quick.active { background: var(--c-quick); border-color: var(--c-quick); }
        .filter-chip.high.active { background: var(--c-high); border-color: var(--c-high); }

        .review-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 32px 30px 26px 30px; background: var(--c-surface); }
        .review-progress { display: flex; gap: 6px; justify-content: center; margin-bottom: 22px; }
        .review-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--c-line); }
        .review-dot.active { background: var(--c-accent); width: 18px; border-radius: 4px; }
        .review-dot.past { background: var(--c-ink-soft); }
        .review-card { background: var(--c-bg); border: 1px solid var(--c-line); border-radius: 14px; padding: 26px 28px; max-width: 540px; margin: 0 auto; }
        .review-breadcrumb { text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-muted); margin-bottom: 4px; }
        .review-prompt { font-family: 'Manrope', sans-serif; font-size: 19px; font-weight: 700; text-align: center; margin-bottom: 4px; }
        .review-count { text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--c-muted); margin-bottom: 18px; }
        .review-nav { display: flex; justify-content: space-between; align-items: center; max-width: 540px; margin: 18px auto 0 auto; }
        .nav-btn { display: flex; align-items: center; gap: 5px; background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 9px; padding: 8px 14px; cursor: pointer; font-size: 13px; color: var(--c-ink-soft); }
        .nav-btn:hover { background: rgba(20,22,26,0.04); }
        .nav-btn.primary { background: var(--c-ink); color: #fff; border-color: var(--c-ink); }
        .nav-btn.primary:hover { background: #000; }
        .finish-banner { text-align: center; padding: 40px 20px; }
        .finish-banner h3 { font-family: 'Manrope', sans-serif; font-size: 20px; font-weight: 800; margin-bottom: 8px; }
        .finish-banner p { color: var(--c-muted); font-size: 13.5px; margin-bottom: 20px; }

        @media (max-width: 720px) {
          .board-body { flex-direction: column; }
          .tab-rail { width: 100%; max-height: 42vh; border-bottom: 1px solid var(--c-line); padding: 12px 10px; }
          .panel { padding: 16px 16px 24px 16px; }
          .board-header { padding: 14px 16px; }
          .board-title { font-size: 16px; }
          .add-task-bar input, .cat-edit-row input, .add-cat-row input, .add-sub-row input { font-size: 16px; }
          .task-row {
            flex-wrap: wrap;
            row-gap: 6px;
            padding: 12px 8px;
            border-radius: 0;
            border-bottom: 1px solid var(--c-line);
          }
          .task-row:last-child { border-bottom: none; }
          /* Line 1: flag + tag on the left, effort/status/delete pushed to the right */
          .effort-btn.quick { margin-left: auto; }
          /* Line 2: task name, full width, so it starts at the same left indent as the flag/tag above */
          .task-text { order: 99; flex-basis: 100%; min-width: 0; }
          .icon-btn, .flag-btn, .effort-btn, .sub-del { padding: 6px; }
          .sub-del { opacity: 1; }
          .review-wrap { padding: 22px 14px 20px 14px; }
          .review-card { padding: 20px 16px; }
          .review-nav { max-width: 100%; }
        }
      `}</style>

      <div className="board-header">
        <div>
          <div className="board-title">Daily Board</div>
          <div className="board-subtitle">Ray White Altona</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className={`save-indicator ${saveState === "error" ? "error" : ""}`}>
            {saveState === "saving" ? "saving…" : saveState === "error" ? "save failed" : "saved"}
          </span>
          {mode === "board" ? (
            <button className="review-btn" onClick={startReview}><PlayCircle size={15} /> Start daily review</button>
          ) : (
            <button className="review-btn exit" onClick={endReview}><X size={15} /> Exit review</button>
          )}
        </div>
      </div>

      <DayProgressBar count={todayCompletedCount} />

      {mode === "board" ? (
        <div className="board-body">
          <div className="tab-rail">
            <div
              className={`all-tab ${activeCat === ALL_ID ? "active" : ""}`}
              onClick={() => { setActiveCat(ALL_ID); setActiveSub(null); }}
            >
              <ListChecks size={15} />
              All tasks
              <span className="all-tab-count">{totalOpen}</span>
            </div>

            {categories.map((cat) => {
              const isActiveCat = activeCat === cat.id;
              const subs = subsOf(cat.id);
              return (
                <div className="cat-block" key={cat.id}>
                  {editingCats ? (
                    <div className="cat-edit-row">
                      <input value={cat.name} onChange={(e) => renameCategory(cat.id, e.target.value)} />
                      <button className="icon-btn" onClick={() => moveCategory(cat.id, -1)} title="Move up"><ArrowUp size={13} /></button>
                      <button className="icon-btn" onClick={() => moveCategory(cat.id, 1)} title="Move down"><ArrowDown size={13} /></button>
                      <button className="icon-btn danger" onClick={() => deleteCategory(cat.id)} title="Delete category"><Trash2 size={13} /></button>
                    </div>
                  ) : (
                    <div className={`tab ${isActiveCat ? "active" : ""}`} onClick={() => { setActiveCat(cat.id); setActiveSub(null); }}>
                      <ChevronDown size={13} className={`tab-chevron ${isActiveCat ? "" : "closed"}`} />
                      {cat.priorityTaskId && <span className="priority-dot" />}
                      <span className="tab-name">{cat.name}</span>
                      <span className={`tab-count ${openTasksForCategory(cat.id).length === 0 ? "zero" : ""}`}>{openTasksForCategory(cat.id).length}</span>
                    </div>
                  )}

                  {!editingCats && isActiveCat && (
                    <div className="sub-list">
                      {subs.map((sub) => (
                        <div key={sub.id} className={`sub-tab ${activeSub === sub.id ? "active" : ""}`} onClick={() => { setActiveCat(cat.id); setActiveSub(sub.id); }}>
                          <button
                            className="health-dot"
                            style={{ background: HEALTH_META[sub.health || "green"].varColor }}
                            onClick={(e) => { e.stopPropagation(); cycleHealth(sub.id); }}
                            title={`${HEALTH_META[sub.health || "green"].label} — click to change`}
                          />
                          <span className="sub-name">{sub.name}</span>
                          <span className="sub-count">{openTasksForSub(sub.id).length || ""}</span>
                          <button className="sub-del" onClick={(e) => { e.stopPropagation(); deleteSubcategory(sub.id); }} title="Delete project"><X size={11} /></button>
                        </div>
                      ))}
                      <div className="add-sub-row">
                        <input
                          placeholder="+ Add project…"
                          value={newSubName[cat.id] || ""}
                          onChange={(e) => setNewSubName((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && addSubcategory(cat.id)}
                        />
                        <button onClick={() => addSubcategory(cat.id)}><Plus size={13} /></button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {editingCats && (
              <div className="add-cat-row">
                <input placeholder="New main category…" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} />
                <button onClick={addCategory}><Plus size={14} /></button>
              </div>
            )}

            <div className="rail-footer">
              <button className="edit-toggle" onClick={() => setEditingCats((v) => !v)}>
                <Pencil size={12} /> {editingCats ? "Done editing" : "Edit main categories"}
              </button>
            </div>
          </div>

          <div className="panel">
            {activeCat === ALL_ID ? (
              <AllTasksView categories={categories} tasks={tasks} priorityTasks={priorityTasks} onCycle={cycleStatus} onDelete={deleteTask} onTogglePriority={togglePriority} onSetEffort={setEffort} />
            ) : (
              <>
                <div className="add-task-bar">
                  <input
                    placeholder={`Add to ${targetLabel}…`}
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && activeCat) { addTask(activeCat, activeSub, newTaskText); setNewTaskText(""); } }}
                  />
                  <button onClick={() => { if (activeCat) { addTask(activeCat, activeSub, newTaskText); setNewTaskText(""); } }}><Plus size={14} /> Add</button>
                </div>

                {activeCategory ? (
                  activeSubcat ? (
                    <SubcategoryTaskList tasks={allTasksForSub(activeSubcat.id)} category={activeCategory} onCycle={cycleStatus} onDelete={deleteTask} onClearDone={clearDoneInScope} onTogglePriority={togglePriority} onSetEffort={setEffort} />
                  ) : (
                    <CategoryCombinedList category={activeCategory} subs={subsOf(activeCategory.id)} tasks={tasks} onCycle={cycleStatus} onDelete={deleteTask} onClearDone={clearDoneInScope} onTogglePriority={togglePriority} onSetEffort={setEffort} />
                  )
                ) : (
                  <div className="empty-state">No categories yet — add one on the left.</div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <ReviewMode
          steps={reviewSteps} reviewIndex={reviewIndex} setReviewIndex={setReviewIndex}
          openTasksForCategory={openTasksForCategory} openTasksForSub={openTasksForSub}
          cycleStatus={cycleStatus} deleteTask={deleteTask} addTask={addTask} onTogglePriority={togglePriority} onSetEffort={setEffort}
          reviewInputs={reviewInputs} setReviewInputs={setReviewInputs} endReview={endReview}
        />
      )}
    </div>
  );
}

function DayProgressBar({ count }) {
  let bg, color, star = false;
  if (count >= 21) { bg = "var(--c-progress-green)"; color = "#fff"; star = true; }
  else if (count >= 16) { bg = "var(--c-progress-green)"; color = "#fff"; }
  else if (count >= 11) { bg = "var(--c-progress-blue)"; color = "#0C4A6E"; }
  else if (count >= 6) { bg = "var(--c-waiting)"; color = "#1F1400"; }
  else { bg = "var(--c-priority)"; color = "#fff"; }

  return (
    <div className="day-progress-bar" style={{ background: bg, color }}>
      {star && <Star size={14} fill="#FFD700" color="#8A6D00" />}
      <span>{count} task{count === 1 ? "" : "s"} completed today</span>
    </div>
  );
}

function AllTasksView({ categories, tasks, priorityTasks, onCycle, onDelete, onTogglePriority, onSetEffort }) {
  const [filter, setFilter] = useState("all");
  const open = tasks.filter((t) => t.status !== "done");
  const priorityIds = new Set(priorityTasks.map((p) => p.task.id));
  let rest = open.filter((t) => !priorityIds.has(t.id));
  if (filter === "quick") rest = rest.filter((t) => t.effort === "quick");
  if (filter === "high") rest = rest.filter((t) => t.effort === "high");

  return (
    <>
      {priorityTasks.length > 0 && (
        <>
          <div className="section-label">Priority</div>
          {priorityTasks.map(({ cat, task }) => (
            <TaskRow key={task.id} task={task} tag={cat.name} isPriority onCycle={onCycle} onDelete={onDelete} onTogglePriority={() => onTogglePriority(cat.id, task.id)} onSetEffort={onSetEffort} />
          ))}
        </>
      )}

      <div className="section-label" style={{ marginTop: priorityTasks.length ? 18 : 0 }}>All open tasks</div>
      <div className="filter-row">
        <button className={`filter-chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All</button>
        <button className={`filter-chip quick ${filter === "quick" ? "active" : ""}`} onClick={() => setFilter(filter === "quick" ? "all" : "quick")}>Quick & easy</button>
        <button className={`filter-chip high ${filter === "high" ? "active" : ""}`} onClick={() => setFilter(filter === "high" ? "all" : "high")}>High impact</button>
      </div>

      {rest.length === 0 ? (
        <div className="empty-state"><Circle size={13} /> Nothing here.</div>
      ) : (
        rest.map((t) => {
          const cat = categories.find((c) => c.id === t.categoryId);
          return <TaskRow key={t.id} task={t} tag={cat ? cat.name : ""} onCycle={onCycle} onDelete={onDelete} onTogglePriority={() => cat && onTogglePriority(cat.id, t.id)} onSetEffort={onSetEffort} />;
        })
      )}
    </>
  );
}

function CategoryCombinedList({ category, subs, tasks, onCycle, onDelete, onClearDone, onTogglePriority, onSetEffort }) {
  const generalTasks = tasks.filter((t) => t.categoryId === category.id && t.subcategoryId == null);
  const anyOpen = generalTasks.some((t) => t.status !== "done") || subs.some((s) => tasks.some((t) => t.subcategoryId === s.id && t.status !== "done"));
  const anyDone = generalTasks.some((t) => t.status === "done") || subs.some((s) => tasks.some((t) => t.subcategoryId === s.id && t.status === "done"));
  const hasSubTasks = subs.some((s) => tasks.some((t) => t.subcategoryId === s.id));

  return (
    <>
      {!anyOpen && !anyDone && <div className="empty-state"><Circle size={13} /> Nothing here — you're clear.</div>}

      {generalTasks.length > 0 && hasSubTasks && <div className="group-header">General</div>}
      {generalTasks.map((t) => (
        <TaskRow key={t.id} task={t} isPriority={category.priorityTaskId === t.id} onCycle={onCycle} onDelete={onDelete} onTogglePriority={() => onTogglePriority(category.id, t.id)} onSetEffort={onSetEffort} />
      ))}

      {subs.map((sub) => {
        const subTasks = tasks.filter((t) => t.subcategoryId === sub.id);
        if (subTasks.length === 0) return null;
        return (
          <div key={sub.id}>
            <div className="group-header">{sub.name}</div>
            {subTasks.map((t) => (
              <TaskRow key={t.id} task={t} isPriority={category.priorityTaskId === t.id} onCycle={onCycle} onDelete={onDelete} onTogglePriority={() => onTogglePriority(category.id, t.id)} onSetEffort={onSetEffort} />
            ))}
          </div>
        );
      })}

      {anyDone && <button className="clear-done-btn" onClick={onClearDone}><RotateCcw size={12} /> Clear done</button>}
    </>
  );
}

function SubcategoryTaskList({ tasks, category, onCycle, onDelete, onClearDone, onTogglePriority, onSetEffort }) {
  const anyDone = tasks.some((t) => t.status === "done");
  return (
    <>
      {tasks.length === 0 && <div className="empty-state"><Circle size={13} /> Nothing here — you're clear.</div>}
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} isPriority={category.priorityTaskId === t.id} onCycle={onCycle} onDelete={onDelete} onTogglePriority={() => onTogglePriority(category.id, t.id)} onSetEffort={onSetEffort} />
      ))}
      {anyDone && <button className="clear-done-btn" onClick={onClearDone}><RotateCcw size={12} /> Clear done</button>}
    </>
  );
}

function TaskRow({ task, tag, isPriority, onCycle, onDelete, onTogglePriority, onSetEffort }) {
  const meta = STATUS_META[task.status];
  return (
    <div className={`task-row status-${task.status} ${isPriority ? "priority" : ""}`}>
      <button className={`flag-btn ${isPriority ? "active" : ""}`} onClick={onTogglePriority} title="Mark as this category's priority">
        <Flag size={14} fill={isPriority ? "currentColor" : "none"} />
      </button>
      {tag && <span className="task-tag">{tag}</span>}
      <span className={`task-text ${task.status === "done" ? "done" : ""}`}>{task.text}</span>
      <button className={`effort-btn quick ${task.effort === "quick" ? "active" : ""}`} onClick={() => onSetEffort(task.id, "quick")} title="Quick & easy — under 2 minutes">
        <Zap size={12} fill={task.effort === "quick" ? "currentColor" : "none"} />
      </button>
      <button className={`effort-btn high ${task.effort === "high" ? "active" : ""}`} onClick={() => onSetEffort(task.id, "high")} title="High impact — hours of focus">
        <Flame size={12} fill={task.effort === "high" ? "currentColor" : "none"} />
      </button>
      <button className="status-pill" style={{ "--pill-color": meta.varColor, "--pill-text": meta.textColor }} onClick={() => onCycle(task.id)} title="Click to change status">
        {task.status === "done" ? <Check size={11} /> : task.status === "waiting" ? <Clock size={11} /> : null}
        {meta.label}
      </button>
      <button className="icon-btn danger" onClick={() => onDelete(task.id)} title="Delete task"><Trash2 size={13} /></button>
    </div>
  );
}

function ReviewMode({
  steps, reviewIndex, setReviewIndex, openTasksForCategory, openTasksForSub,
  cycleStatus, deleteTask, addTask, onTogglePriority, onSetEffort, reviewInputs, setReviewInputs, endReview
}) {
  const finished = reviewIndex >= steps.length;
  const step = steps[reviewIndex];
  const inputVal = step ? (reviewInputs[step.key] || "") : "";
  const openTasks = step ? (step.sub ? openTasksForSub(step.sub.id) : openTasksForCategory(step.cat.id).filter((t) => t.subcategoryId == null)) : [];

  if (steps.length === 0) {
    return (
      <div className="review-wrap">
        <div className="finish-banner"><h3>No categories to review</h3><p>Add a category first, back on the board.</p><button className="nav-btn primary" onClick={endReview}>Back to board</button></div>
      </div>
    );
  }
  if (finished) {
    return (
      <div className="review-wrap">
        <div className="finish-banner"><h3>Review done.</h3><p>You've been through all {steps.length} stops.</p><button className="nav-btn primary" onClick={endReview}>Back to board</button></div>
      </div>
    );
  }

  return (
    <div className="review-wrap">
      <div className="review-progress">
        {steps.map((s, i) => <div key={s.key} className={`review-dot ${i === reviewIndex ? "active" : i < reviewIndex ? "past" : ""}`} />)}
      </div>
      <div className="review-card">
        {step.breadcrumb && <div className="review-breadcrumb">{step.breadcrumb}</div>}
        <div className="review-prompt" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {step.sub && <span className="health-dot" style={{ background: HEALTH_META[step.sub.health || "green"].varColor, cursor: "default" }} title={HEALTH_META[step.sub.health || "green"].label} />}
          Anything for {step.label}?
        </div>
        <div className="review-count">{openTasks.length} open task{openTasks.length === 1 ? "" : "s"}</div>

        {openTasks.length === 0 ? (
          <div className="empty-state" style={{ justifyContent: "center" }}><Circle size={13} /> Nothing here — you're clear.</div>
        ) : (
          openTasks.map((task) => (
            <TaskRow key={task.id} task={task} isPriority={step.cat.priorityTaskId === task.id} onCycle={cycleStatus} onDelete={deleteTask} onTogglePriority={() => onTogglePriority(step.cat.id, task.id)} onSetEffort={onSetEffort} />
          ))
        )}

        <div className="add-task-bar" style={{ marginTop: 14, marginBottom: 0 }}>
          <input
            placeholder={`Add to ${step.label}…`}
            value={inputVal}
            onChange={(e) => setReviewInputs((prev) => ({ ...prev, [step.key]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && inputVal.trim()) { addTask(step.cat.id, step.sub ? step.sub.id : null, inputVal); setReviewInputs((prev) => ({ ...prev, [step.key]: "" })); } }}
          />
          <button onClick={() => { if (inputVal.trim()) { addTask(step.cat.id, step.sub ? step.sub.id : null, inputVal); setReviewInputs((prev) => ({ ...prev, [step.key]: "" })); } }}><Plus size={14} /> Add</button>
        </div>
      </div>

      <div className="review-nav">
        <button className="nav-btn" onClick={() => setReviewIndex((i) => Math.max(0, i - 1))} disabled={reviewIndex === 0} style={{ opacity: reviewIndex === 0 ? 0.4 : 1 }}><ChevronLeft size={14} /> Back</button>
        <button className="nav-btn primary" onClick={() => setReviewIndex((i) => i + 1)}>{reviewIndex === steps.length - 1 ? "Finish" : "Next"} <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}
