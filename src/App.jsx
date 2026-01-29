import React, { useState, useEffect, useMemo, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  signInWithCustomToken,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  increment,
  arrayUnion,
  getDoc,
  orderBy,
  writeBatch,
  getDocs,
} from "firebase/firestore";
import {
  Flame,
  CheckCircle2,
  Plus,
  Users,
  Trophy,
  LogOut,
  TrendingUp,
  MessageCircleHeart,
  Zap,
  Coins,
  X,
  Loader2,
  UserPlus,
  User,
  AlertCircle,
  Check,
  Calendar as CalendarIcon,
  Undo2,
  Edit2,
  Save,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Bell,
  CalendarDays,
  Repeat,
  MessageSquare,
  Send,
} from "lucide-react";

// --- Firebase Initialization ---
const firebaseConfig = {
  apiKey: "AIzaSyBp7mDobIYrVIUkDfuClqqfdm9JIYW3yvs",
  authDomain: "gate26-mocks.firebaseapp.com",
  projectId: "gate26-mocks",
  storageBucket: "gate26-mocks.firebasestorage.app",
  messagingSenderId: "46444663512",
  appId: "1:46444663512:web:701e86ce9f47735ae1fdad",
  measurementId: "G-2JZTZYTEWJ",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const getAppId = () => {
  return "habit-squad-main";
};

// --- Helpers ---

// Get current date in IST (Indian Standard Time) YYYY-MM-DD
const getTodayDate = () => {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

// Get ISO week number for Weekly streak calculation
const getWeekNumber = (d) => {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return [d.getUTCFullYear(), weekNo];
};

const calculateStreak = (history, frequency = { type: "daily", days: [] }) => {
  if (!history || history.length === 0) return 0;

  // Sort history newest to oldest
  const sorted = [...history].sort((a, b) => new Date(b) - new Date(a));
  const todayStr = getTodayDate();

  // -- DAILY STREAK --
  if (!frequency || frequency.type === "daily") {
    const today = new Date(todayStr);
    const lastCompleted = new Date(sorted[0]);

    // Check if broken (if last completed was before yesterday)
    // Note: In JS, date subtraction gives ms. 86400000ms = 1 day.
    const diffTime = Math.abs(today - lastCompleted);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 1) return 0; // Streak broken

    let streak = 0;
    let checkDate = new Date(lastCompleted); // Start checking from last completion backwards

    for (let i = 0; i < sorted.length; i++) {
      const date = new Date(sorted[i]);
      // Allow multiple entries on same day without breaking/incrementing streak incorrectly
      if (i > 0 && date.getTime() === new Date(sorted[i - 1]).getTime())
        continue;

      const expectedTime = checkDate.getTime();
      const actualTime = date.getTime();

      if (actualTime === expectedTime) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  // -- CUSTOM STREAK (Specific Days) --
  if (frequency.type === "custom") {
    if (!frequency.days || frequency.days.length === 0) return 0;

    // Find the most recent *scheduled* day
    const scheduledDays = frequency.days.map((d) => parseInt(d)); // [0, 2, 4] for Sun, Tue, Thu
    const today = new Date(todayStr);
    let checkDate = new Date(today);

    // If today is not a scheduled day, roll back to previous scheduled day to start check
    while (!scheduledDays.includes(checkDate.getDay())) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // Does history have an entry for the most recent scheduled day?
    const lastRequiredStr = checkDate.toLocaleDateString("en-CA");
    if (sorted[0] < lastRequiredStr) return 0; // Broken

    // If active, count backwards skipping non-scheduled days
    let streak = 0;
    let historyIdx = 0;

    // We iterate "scheduled slots" backwards
    // Safety break after 365 checks to prevent infinite loop
    for (let i = 0; i < 365; i++) {
      const checkStr = checkDate.toLocaleDateString("en-CA");

      // Find if this scheduled date exists in history
      // Since sorted is desc, we can optimize search? Just linear scan for now.
      if (history.includes(checkStr)) {
        streak++;
        // Move checkDate back to previous scheduled day
        do {
          checkDate.setDate(checkDate.getDate() - 1);
        } while (!scheduledDays.includes(checkDate.getDay()));
      } else {
        // Missed a scheduled day
        break;
      }
    }
    return streak;
  }

  // -- WEEKLY STREAK --
  if (frequency.type === "weekly") {
    // Logic: Consecutive weeks with at least one completion
    // Current week must be completed OR it must be previous week completed
    const currentWeek = getWeekNumber(new Date(todayStr));
    const lastHistoryDate = new Date(sorted[0]);
    const lastHistoryWeek = getWeekNumber(lastHistoryDate);

    // If last completion was more than 1 week ago (e.g. current is W10, last was W8), broken
    if (currentWeek[0] === lastHistoryWeek[0]) {
      if (currentWeek[1] - lastHistoryWeek[1] > 1) return 0;
    } else {
      // Handle year boundary roughly
      // If years differ by > 1 or (diff 1 and weeks not adjacent), roughly broken
      // Simplified: just check raw timestamps for > 14 days gap as a heuristic fallback
      const diffTime = new Date(todayStr) - lastHistoryDate;
      if (diffTime > 14 * 86400000) return 0;
    }

    let streak = 0;
    let expectedWeek = lastHistoryWeek; // Start from latest completion's week

    // Group history by week
    const weeksMap = new Set();
    history.forEach((h) => {
      const w = getWeekNumber(new Date(h));
      weeksMap.add(`${w[0]}-${w[1]}`);
    });

    // Count backwards from expectedWeek
    while (weeksMap.has(`${expectedWeek[0]}-${expectedWeek[1]}`)) {
      streak++;
      // Go to previous week
      if (expectedWeek[1] === 1) {
        expectedWeek = [expectedWeek[0] - 1, 52]; // Simplified year rollback
      } else {
        expectedWeek = [expectedWeek[0], expectedWeek[1] - 1];
      }
      // Safety break
      if (streak > 500) break;
    }
    return streak;
  }

  // -- MONTHLY STREAK --
  if (frequency.type === "monthly") {
    const today = new Date(todayStr);
    const lastHist = new Date(sorted[0]);

    // Check if current month or prev month has entry
    const monthDiff =
      (today.getFullYear() - lastHist.getFullYear()) * 12 +
      (today.getMonth() - lastHist.getMonth());
    if (monthDiff > 1) return 0;

    let streak = 0;
    let checkYear = lastHist.getFullYear();
    let checkMonth = lastHist.getMonth();

    const monthsMap = new Set();
    history.forEach((h) => {
      const d = new Date(h);
      monthsMap.add(`${d.getFullYear()}-${d.getMonth()}`);
    });

    while (monthsMap.has(`${checkYear}-${checkMonth}`)) {
      streak++;
      checkMonth--;
      if (checkMonth < 0) {
        checkMonth = 11;
        checkYear--;
      }
      if (streak > 120) break;
    }
    return streak;
  }

  return 0;
};

// Check if habit is "Completed" for the current period (Today/Week/Month)
const isHabitCompleted = (habit) => {
  const todayStr = getTodayDate();
  const history = habit.history || [];
  const freq = habit.frequency || { type: "daily" };

  if (!history.length) return false;

  if (freq.type === "daily" || freq.type === "custom") {
    return history.includes(todayStr);
  }

  if (freq.type === "weekly") {
    // Check if any date in history falls in current week
    const today = new Date(todayStr);
    // Start of week (Sunday)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    return history.some((d) => new Date(d) >= startOfWeek);
  }

  if (freq.type === "monthly") {
    const today = new Date(todayStr);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return history.some((d) => new Date(d) >= startOfMonth);
  }

  return false;
};

// --- Shared Components ---

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColors = {
    success: "bg-emerald-600",
    error: "bg-red-600",
    info: "bg-blue-600",
  };

  return (
    <div
      className={`fixed top-4 right-4 z-[100] ${bgColors[type] || bgColors.info} text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-5 border border-white/10`}
    >
      {type === "success" && <Check size={20} />}
      {type === "error" && <AlertCircle size={20} />}
      <span className="font-medium text-sm font-sans">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 hover:bg-white/20 p-1 rounded-full"
      >
        <X size={16} />
      </button>
    </div>
  );
};

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-gray-900 rounded-2xl max-w-sm w-full p-6 border border-gray-800 shadow-2xl scale-100">
        <h3 className="text-xl font-bold text-white mb-2 font-display">
          {title}
        </h3>
        <p className="text-gray-400 mb-6 text-sm leading-relaxed font-sans">
          {message}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg transition-colors font-sans"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors font-sans"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Auth Component ---
const Auth = ({ setUser, showToast }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const appId = getAppId();

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        showToast("Welcome back to the squad!", "success");
      } else {
        if (password.length < 6) throw { code: "auth/weak-password" };
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        await updateProfile(userCredential.user, { displayName: name });

        await setDoc(
          doc(
            db,
            "artifacts",
            appId,
            "public",
            "data",
            "users",
            userCredential.user.uid,
          ),
          {
            uid: userCredential.user.uid,
            displayName: name,
            email: email,
            coins: 100,
            cheers: 0,
            joinedAt: new Date().toISOString(),
          },
          { merge: true },
        );
        showToast("Account created! +100 Coins", "success");
      }
    } catch (err) {
      console.error(err);
      let msg = "An error occurred.";
      switch (err.code) {
        case "auth/user-not-found":
          msg = "No account found. Please Sign Up first.";
          break;
        case "auth/wrong-password":
          msg = "Incorrect password. Please try again.";
          break;
        case "auth/invalid-credential":
        case "auth/invalid-login-credentials":
          // Newer Firebase versions return this for both user-not-found and wrong-password to prevent enumeration
          if (isLogin) {
            msg = "Invalid credentials. If you are new, please Sign Up.";
          } else {
            msg = "Registration failed. Please check your details.";
          }
          break;
        case "auth/email-already-in-use":
          msg = "Email already in use. Try logging in.";
          break;
        case "auth/invalid-email":
          msg = "Please enter a valid email address.";
          break;
        case "auth/weak-password":
          msg = "Password must be at least 6 characters.";
          break;
        case "auth/network-request-failed":
          msg = "Network error. Please check your connection.";
          break;
        case "auth/too-many-requests":
          msg = "Too many attempts. Please try again later.";
          break;
        default:
          msg = err.message || "Authentication failed.";
      }
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4 font-sans">
      {/* Dynamic Font Styles */}
      <style>{`
        :root {
          --font-sans: 'Montserrat', sans-serif;
          --font-display: 'Bricolage Grotesque', sans-serif;
        }
        body { font-family: var(--font-sans); }
        .font-sans { font-family: var(--font-sans); }
        .font-display { font-family: var(--font-display); }
        h1, h2, h3, h4, .font-bricolage { font-family: var(--font-display); }
      `}</style>
      <div className="max-w-md w-full bg-gray-900/50 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden border border-gray-800">
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="bg-orange-600 p-4 rounded-2xl shadow-lg shadow-orange-900/20">
              <Flame size={40} className="text-white fill-orange-400" />
            </div>
          </div>
          <h2 className="text-3xl font-bold text-center text-white mb-2 tracking-tight font-display">
            HabitSquad
          </h2>
          <p className="text-center text-gray-500 mb-8 text-sm">
            {isLogin
              ? "Welcome back, legend."
              : "Join the squad. Build the streak."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors placeholder-gray-600"
                  placeholder="HabitHero"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors placeholder-gray-600"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors placeholder-gray-600"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] flex justify-center items-center disabled:opacity-50 mt-2 font-display tracking-wide"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : isLogin ? (
                "LOG IN"
              ) : (
                "SIGN UP"
              )}
            </button>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-800"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest">
              <span className="px-3 bg-gray-900 text-gray-600">or</span>
            </div>
          </div>

          <div className="text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-gray-400 hover:text-white text-sm transition-colors font-medium"
            >
              {isLogin
                ? "Need an account? Sign Up"
                : "Already have an account? Log In"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App Logic ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("habits");
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [habitToEdit, setHabitToEdit] = useState(null);
  const [toast, setToast] = useState(null);
  const [viewingFriendId, setViewingFriendId] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const notificationRef = useRef(null);
  const appId = getAppId();

  const showToast = (message, type = "info") => {
    setToast({ message, type });
  };

  // Inject Fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
        try {
          await signInWithCustomToken(auth, __initial_auth_token);
        } catch (e) {
          console.error("Token auth failed", e);
        }
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userRef = doc(
            db,
            "artifacts",
            appId,
            "public",
            "data",
            "users",
            currentUser.uid,
          );
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(
              userRef,
              {
                uid: currentUser.uid,
                displayName: currentUser.displayName || "Habit Hero",
                email: currentUser.email || "hero@habitsquad.app",
                coins: 0,
                cheers: 0,
                joinedAt: new Date().toISOString(),
              },
              { merge: true },
            );
          }
        } catch (e) {}
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [appId]);

  // Notifications Listener
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "users",
        user.uid,
        "notifications",
      ),
      orderBy("timestamp", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [user, appId]);

  // Click outside to close notifications
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target)
      ) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDismissNotification = async (notifId) => {
    try {
      await deleteDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "users",
          user.uid,
          "notifications",
          notifId,
        ),
      );
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearAllNotifications = async () => {
    if (notifications.length === 0) return;
    try {
      const batch = writeBatch(db);
      notifications.forEach((n) => {
        const ref = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "users",
          user.uid,
          "notifications",
          n.id,
        );
        batch.delete(ref);
      });
      await batch.commit();
      showToast("Notifications cleared", "info");
    } catch (e) {
      console.error(e);
      showToast("Failed to clear notifications", "error");
    }
  };

  const handleEditHabit = (habit) => {
    setHabitToEdit(habit);
    setShowHabitModal(true);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        <Loader2 className="animate-spin text-orange-500" size={48} />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {/* Toast rendered here for Auth errors */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
        <Auth setUser={setUser} showToast={showToast} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-orange-500/30 pb-24">
      {/* Dynamic Font Styles */}
      <style>{`
        :root {
          --font-sans: 'Montserrat', sans-serif;
          --font-display: 'Bricolage Grotesque', sans-serif;
        }
        body { font-family: var(--font-sans); }
        .font-sans { font-family: var(--font-sans); }
        .font-display { font-family: var(--font-display); }
        h1, h2, h3, h4, .font-bricolage { font-family: var(--font-display); }
      `}</style>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-950/80 backdrop-blur-lg border-b border-white/5 px-4 py-3">
        <div className="max-w-2xl mx-auto flex justify-between items-center relative">
          <div className="flex items-center gap-2">
            <div className="bg-orange-600 p-1.5 rounded-lg">
              <Flame size={18} className="text-white fill-white" />
            </div>
            <h1 className="font-bold text-xl tracking-tight hidden sm:block text-gray-100 font-display">
              HabitSquad
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <UserProfileBadge user={user} appId={appId} />

            {/* Notification Bell */}
            <div className="relative" ref={notificationRef}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-full transition-all relative"
              >
                <Bell size={20} />
                {notifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-gray-950 animate-pulse"></span>
                )}
              </button>

              {/* Notification Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="p-3 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                    <h3 className="font-semibold text-sm text-gray-300 font-display">
                      Notifications
                    </h3>
                    {notifications.length > 0 && (
                      <button
                        onClick={handleClearAllNotifications}
                        className="text-xs text-orange-500 hover:text-orange-400 font-medium"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-gray-500 text-sm">
                        No new notifications
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className="p-3 border-b border-gray-800/50 hover:bg-white/5 flex items-start gap-3 last:border-0"
                        >
                          <div
                            className={`${n.type === "message" ? "bg-blue-500/10 text-blue-500" : "bg-pink-500/10 text-pink-500"} p-1.5 rounded-full shrink-0 mt-0.5`}
                          >
                            {n.type === "message" ? (
                              <MessageSquare size={14} />
                            ) : (
                              <Zap size={14} className="fill-current" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-200 font-sans">
                              <span className="font-bold text-white font-display">
                                {n.from}
                              </span>{" "}
                              {n.type === "message" ? (
                                <span className="text-gray-300">
                                  : {n.text}
                                </span>
                              ) : (
                                "cheered you!"
                              )}
                            </p>
                            <p className="text-[10px] text-gray-500 mt-1">
                              {new Date(n.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDismissNotification(n.id)}
                            className="text-gray-600 hover:text-white p-1"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => signOut(auth)}
              className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-full transition-all"
              title="Sign Out"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {activeTab === "habits" && (
          <HabitsView
            user={user}
            appId={appId}
            setShowAddHabit={(show) => {
              if (show) setHabitToEdit(null);
              setShowHabitModal(show);
            }}
            showToast={showToast}
            onEditHabit={handleEditHabit}
          />
        )}
        {activeTab === "squad" && (
          <SquadView user={user} appId={appId} showToast={showToast} />
        )}
        {activeTab === "chat" && (
          <ChatView user={user} appId={appId} showToast={showToast} />
        )}
        {activeTab === "leaderboard" && (
          <LeaderboardView
            user={user}
            appId={appId}
            onSelectFriend={setViewingFriendId}
          />
        )}
        {activeTab === "profile" && (
          <UserProfileDetails
            targetUid={user.uid}
            appId={appId}
            showToast={showToast}
            isOwnProfile={true}
          />
        )}
      </main>

      {/* Friend Profile Modal (Only for Leaderboard clicks now) */}
      {viewingFriendId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-950 rounded-3xl relative border border-gray-800 shadow-2xl">
            <button
              onClick={() => setViewingFriendId(null)}
              className="absolute top-4 right-4 z-50 p-2 bg-gray-800 rounded-full text-white hover:bg-gray-700"
            >
              <X size={20} />
            </button>
            <div className="p-4 pt-10">
              <UserProfileDetails
                targetUid={viewingFriendId}
                appId={appId}
                showToast={showToast}
                isOwnProfile={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-white/5 pb-safe z-30 shadow-2xl">
        <div className="max-w-2xl mx-auto flex justify-around p-2">
          <NavButton
            active={activeTab === "habits"}
            onClick={() => setActiveTab("habits")}
            icon={CheckCircle2}
            label="Habits"
          />
          <NavButton
            active={activeTab === "squad"}
            onClick={() => setActiveTab("squad")}
            icon={Users}
            label="Squad"
          />
          <NavButton
            active={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
            icon={MessageSquare}
            label="Chat"
          />
          <NavButton
            active={activeTab === "leaderboard"}
            onClick={() => setActiveTab("leaderboard")}
            icon={Trophy}
            label="Ranks"
          />
          <NavButton
            active={activeTab === "profile"}
            onClick={() => setActiveTab("profile")}
            icon={User}
            label="Profile"
          />
        </div>
      </nav>

      {showHabitModal && (
        <AddHabitModal
          onClose={() => {
            setShowHabitModal(false);
            setHabitToEdit(null);
          }}
          user={user}
          appId={appId}
          showToast={showToast}
          habitToEdit={habitToEdit}
        />
      )}
    </div>
  );
}

// --- Sub-Components ---

const UserProfileBadge = ({ user, appId }) => {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "artifacts", appId, "public", "data", "users", user.uid),
      (docSnap) => {
        if (docSnap.exists()) setProfile(docSnap.data());
      },
    );
    return () => unsub();
  }, [user, appId]);

  if (!profile) return null;
  return (
    <div className="flex items-center gap-4 bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
      <div className="flex items-center gap-1.5 text-yellow-400">
        <Coins size={14} className="fill-current" />
        <span className="font-bold font-mono text-sm font-display">
          {profile.coins || 0}
        </span>
      </div>
      <div className="w-px h-3 bg-white/10"></div>
      <div className="flex items-center gap-1.5 text-pink-400">
        <MessageCircleHeart size={14} className="fill-current" />
        <span className="font-bold font-mono text-sm font-display">
          {profile.cheers || 0}
        </span>
      </div>
    </div>
  );
};

const NavButton = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center p-2 rounded-xl transition-all w-14 sm:w-20 ${active ? "text-orange-500" : "text-gray-500 hover:text-gray-300"}`}
  >
    <Icon size={24} strokeWidth={active ? 2.5 : 2} />
    <span
      className={`text-[13px] mt-1 font-medium font-display tracking-wide opacity-100"`}
    >
      {label}
    </span>
  </button>
);

// --- User Profile Details (Reused for Own Profile and Friend Profile) ---
const UserProfileDetails = ({ targetUid, appId, showToast, isOwnProfile }) => {
  const [profile, setProfile] = useState(null);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current, 1 = prev, 2 = 2 months ago

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const userRef = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "users",
      targetUid,
    );
    const unsubUser = onSnapshot(userRef, (doc) => {
      const data = doc.data();
      setProfile(data);
      if (data) setNewName(data.displayName);
    });

    const q = query(
      collection(db, "artifacts", appId, "public", "data", "habits"),
      where("uid", "==", targetUid),
    );
    const unsubHabits = onSnapshot(q, (snapshot) => {
      const h = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHabits(h);
      setLoading(false);
    });

    return () => {
      unsubUser();
      unsubHabits();
    };
  }, [targetUid, appId]);

  const handleUpdateName = async () => {
    if (!newName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      if (auth.currentUser)
        await updateProfile(auth.currentUser, { displayName: newName });
      const userRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "users",
        targetUid,
      );
      await updateDoc(userRef, { displayName: newName });
      showToast("Profile updated.", "success");
      setIsEditing(false);
    } catch (e) {
      showToast("Failed to update.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const calendarData = useMemo(() => {
    const now = new Date();
    // Calculate first and last day of the selected month
    const year = now.getFullYear();
    const month = now.getMonth() - monthOffset;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    const days = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      // Using IST Date String format for consistency with habit data
      const dateStr = d.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });

      // Count active habits on this day (approx)
      const totalActiveHabits = habits.length;
      const completedCount = habits.filter(
        (h) => h.history && h.history.includes(dateStr),
      ).length;

      let intensity = 0;
      if (totalActiveHabits > 0) {
        const pct = completedCount / totalActiveHabits;
        if (pct === 1) intensity = 3;
        else if (pct >= 0.5) intensity = 2;
        else if (pct > 0) intensity = 1;
      }

      days.push({
        date: d,
        dayNum: i,
        dateStr,
        intensity,
        completedCount,
        total: totalActiveHabits,
      });
    }
    return {
      days,
      monthName: firstDay.toLocaleString("default", {
        month: "long",
        year: "numeric",
      }),
    };
  }, [habits, monthOffset]);

  if (loading || !profile)
    return (
      <div className="text-center py-20 text-gray-500">
        <Loader2 className="animate-spin inline mr-2" /> Loading profile...
      </div>
    );

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-5 fade-in duration-500">
      <div className="bg-gray-900 rounded-3xl p-8 border border-gray-800 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-600/10 blur-3xl rounded-full"></div>
        <div className="flex flex-col items-center relative z-10">
          <div className="w-24 h-24 bg-gradient-to-tr from-orange-500 to-red-600 rounded-2xl flex items-center justify-center text-4xl font-bold text-white mb-5 shadow-2xl shadow-orange-900/40 font-display">
            {profile.displayName ? profile.displayName[0].toUpperCase() : "U"}
          </div>

          <div className="flex items-center gap-3">
            {isEditing && isOwnProfile ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-white px-3 py-1 rounded-lg text-lg font-bold outline-none focus:border-orange-500 w-48 text-center font-display"
                />
                <button
                  onClick={handleUpdateName}
                  disabled={isSaving}
                  className="p-2 bg-green-600 hover:bg-green-500 rounded-lg text-white"
                >
                  {isSaving ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Save size={18} />
                  )}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white"
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-white tracking-tight font-display">
                  {profile.displayName}
                </h2>
                {isOwnProfile && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                )}
              </>
            )}
          </div>
          <p className="text-gray-500 text-sm mt-1">
            {isOwnProfile ? profile.email : "Squad Member"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-8">
          <div className="bg-gray-950/50 p-4 rounded-2xl text-center border border-gray-800">
            <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider font-semibold font-display">
              Coins
            </div>
            <div className="text-2xl font-bold text-yellow-500 flex justify-center items-center gap-2 font-display">
              <Coins size={20} /> {profile.coins || 0}
            </div>
          </div>
          <div className="bg-gray-950/50 p-4 rounded-2xl text-center border border-gray-800">
            <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider font-semibold font-display">
              Cheers
            </div>
            <div className="text-2xl font-bold text-pink-500 flex justify-center items-center gap-2 font-display">
              <MessageCircleHeart size={20} /> {profile.cheers || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Section */}
      <div className="bg-gray-900 rounded-3xl p-6 border border-gray-800">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <CalendarIcon className="text-orange-500" size={20} />
            <h3 className="text-lg font-bold text-white font-display">
              History
            </h3>
          </div>
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setMonthOffset(Math.min(2, monthOffset + 1))}
              disabled={monthOffset >= 2}
              className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-bold w-24 text-center font-display">
              {calendarData.monthName}
            </span>
            <button
              onClick={() => setMonthOffset(Math.max(0, monthOffset - 1))}
              disabled={monthOffset <= 0}
              className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Month Heatmap Grid */}
        <div className="grid grid-cols-7 gap-2">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div
              key={i}
              className="text-center text-[10px] text-gray-600 font-bold font-display"
            >
              {d}
            </div>
          ))}

          {Array.from({ length: calendarData.days[0]?.date.getDay() || 0 }).map(
            (_, i) => (
              <div key={`empty-${i}`}></div>
            ),
          )}

          {calendarData.days.map((day) => (
            <div
              key={day.dateStr}
              className={`
                   aspect-square rounded-md flex items-center justify-center text-xs font-medium transition-all font-display
                   ${
                     day.intensity === 3
                       ? "bg-green-500 text-black shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                       : day.intensity === 2
                         ? "bg-green-700 text-green-100"
                         : day.intensity === 1
                           ? "bg-green-900/60 text-green-500"
                           : "bg-gray-800 text-gray-600"
                   }
                 `}
              title={`${day.dateStr}: ${day.completedCount} / ${day.total}`}
            >
              {day.dayNum}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Chat View ---
const ChatView = ({ user, appId }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef(null);

  // Cleanup old messages on load
  useEffect(() => {
    const cleanupOldMessages = async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const q = query(
        collection(db, "artifacts", appId, "public", "data", "chat"),
        where("timestamp", "<", cutoff),
      );
      try {
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const batch = writeBatch(db);
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (e) {
        console.error("Cleanup error", e);
      }
    };
    cleanupOldMessages();
  }, [appId]);

  // Real-time messages listener
  useEffect(() => {
    const q = query(
      collection(db, "artifacts", appId, "public", "data", "chat"),
      orderBy("timestamp", "asc"),
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, [appId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const messageText = newMessage.trim();
    setNewMessage("");

    try {
      // 1. Add message to chat collection
      await addDoc(
        collection(db, "artifacts", appId, "public", "data", "chat"),
        {
          text: messageText,
          uid: user.uid,
          displayName: user.displayName || "Anonymous",
          timestamp: new Date().toISOString(),
        },
      );

      // 2. Broadcast notification to all other users
      const usersRef = collection(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "users",
      );
      const userSnapshot = await getDocs(usersRef);

      const batch = writeBatch(db);
      let batchCount = 0;

      userSnapshot.docs.forEach((docSnap) => {
        const targetUser = docSnap.data();
        if (targetUser.uid !== user.uid) {
          const ref = doc(
            collection(
              db,
              "artifacts",
              appId,
              "public",
              "data",
              "users",
              targetUser.uid,
              "notifications",
            ),
          );
          batch.set(ref, {
            type: "message",
            from: user.displayName || "Someone",
            fromUid: user.uid,
            text:
              messageText.substring(0, 30) +
              (messageText.length > 30 ? "..." : ""),
            timestamp: new Date().toISOString(),
          });
          batchCount++;
        }
      });

      if (batchCount > 0) {
        await batch.commit();
      }
    } catch (err) {
      console.error("Send error", err);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] bg-gray-900 rounded-3xl overflow-hidden border border-gray-800 shadow-xl">
      <div className="bg-gray-800 p-4 border-b border-gray-700 flex items-center gap-3">
        <MessageSquare className="text-orange-500" size={20} />
        <h3 className="font-bold text-white font-display">Squad Chat</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-10">
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.uid === user.uid;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    isMe
                      ? "bg-orange-600 text-white rounded-br-none"
                      : "bg-gray-800 text-gray-200 rounded-bl-none"
                  }`}
                >
                  {!isMe && (
                    <p className="text-[10px] text-orange-400 font-bold mb-1 uppercase tracking-wide">
                      {msg.displayName}
                    </p>
                  )}
                  {msg.text}
                </div>
                <span className="text-[10px] text-gray-600 mt-1 px-1">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="p-3 bg-gray-800 border-t border-gray-700 flex gap-2"
      >
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-orange-500 text-sm"
        />
        <button
          type="submit"
          disabled={!newMessage.trim()}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:hover:bg-orange-600 text-white p-2.5 rounded-xl transition-colors"
        >
          <Send size={20} />
        </button>
      </form>
    </div>
  );
};

const HabitsView = ({
  user,
  appId,
  setShowAddHabit,
  showToast,
  onEditHabit,
}) => {
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, "artifacts", appId, "public", "data", "habits"),
      where("uid", "==", user.uid),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const habitsData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        habitsData.sort((a, b) => {
          // Sort active first, then date
          const aDone = isHabitCompleted(a);
          const bDone = isHabitCompleted(b);
          if (aDone !== bDone) return aDone ? 1 : -1;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        setHabits(habitsData);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [user, appId]);

  const handleToggleHabit = async (habit) => {
    const todayStr = getTodayDate();
    const isCompleted = isHabitCompleted(habit);
    const habitRef = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "habits",
      habit.id,
    );
    const userRef = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "users",
      user.uid,
    );

    try {
      if (isCompleted) {
        // UNDO
        // For Daily/Custom: remove today
        // For Weekly/Monthly: remove most recent entry in the bucket?
        // Simple logic: remove the specific 'todayStr' if present, or just remove last entry if it matches bucket?
        // To be safe, we only remove 'todayStr' if present. If user did it yesterday for weekly, undoing today shouldn't remove yesterday's.

        let newHistory = (habit.history || []).filter((d) => d !== todayStr);
        // Re-sort
        newHistory.sort((a, b) => new Date(a) - new Date(b));

        const newStreak = calculateStreak(newHistory, habit.frequency);
        const newLastCompleted =
          newHistory.length > 0 ? newHistory[newHistory.length - 1] : null;

        await updateDoc(habitRef, {
          lastCompleted: newLastCompleted,
          streak: newStreak,
          history: newHistory,
          totalCompletions: increment(-1),
        });
        await setDoc(
          userRef,
          { coins: increment(-10), uid: user.uid },
          { merge: true },
        );
        showToast("Undo successful.", "info");
      } else {
        // COMPLETE
        const newHistory = [...(habit.history || []), todayStr];
        const newStreak = calculateStreak(newHistory, habit.frequency);

        await updateDoc(habitRef, {
          lastCompleted: todayStr,
          streak: newStreak,
          history: arrayUnion(todayStr),
          totalCompletions: increment(1),
        });
        await setDoc(
          userRef,
          { coins: increment(10), uid: user.uid },
          { merge: true },
        );
        showToast(`+10 Coins! Streak: ${newStreak}`, "success");
      }
    } catch (e) {
      console.error(e);
      showToast("Action failed.", "error");
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(
        doc(db, "artifacts", appId, "public", "data", "habits", deleteId),
      );
      showToast("Habit deleted.", "info");
    } catch (e) {
      showToast("Failed to delete.", "error");
    } finally {
      setDeleteId(null);
    }
  };

  if (loading)
    return (
      <div className="text-center py-20 text-gray-500">
        <Loader2 className="animate-spin inline mr-2" /> Loading habits...
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center px-1">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight font-display">
            Daily Targets
          </h2>
          <p className="text-gray-400 text-sm">
            Consistent action creates results.
          </p>
        </div>
        <button
          onClick={() => setShowAddHabit(true)}
          className="bg-orange-600 hover:bg-orange-500 text-white p-3 rounded-xl shadow-lg shadow-orange-900/20 transition-all hover:scale-105"
        >
          <Plus size={20} />
        </button>
      </div>

      <ConfirmModal
        isOpen={!!deleteId}
        title="Delete Habit?"
        message="This action cannot be undone. You will lose your streak."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />

      {habits.length === 0 ? (
        <div className="text-center py-16 bg-white/5 rounded-3xl border border-white/5 border-dashed">
          <div className="bg-gray-800 inline-block p-4 rounded-full mb-4">
            <TrendingUp size={32} className="text-gray-500" />
          </div>
          <p className="text-gray-400 mb-6 font-medium">
            No habits yet. Start small.
          </p>
          <button
            onClick={() => setShowAddHabit(true)}
            className="text-orange-400 font-semibold hover:text-orange-300 transition-colors font-display"
          >
            Create your first habit
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {habits.map((habit) => {
            const isCompleted = isHabitCompleted(habit);
            const freqType = habit.frequency?.type || "daily";
            let freqLabel = "Daily";
            if (freqType === "weekly") freqLabel = "Weekly";
            if (freqType === "monthly") freqLabel = "Monthly";
            if (freqType === "custom") {
              const daysMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
              freqLabel = habit.frequency.days
                .map((d) => daysMap[parseInt(d)])
                .join(", ");
            }

            return (
              <div
                key={habit.id}
                className={`group relative bg-gray-900 rounded-2xl p-5 border transition-all duration-300 ${isCompleted ? "border-green-500/20 bg-green-900/5" : "border-gray-800 hover:border-gray-700"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase font-bold text-gray-500 bg-gray-800 px-2 py-0.5 rounded tracking-wider">
                        {freqLabel}
                      </span>
                    </div>
                    <h3
                      className={`font-bold text-lg truncate font-display ${isCompleted ? "text-gray-400 line-through decoration-gray-600" : "text-gray-100"}`}
                    >
                      {habit.title}
                    </h3>
                    {habit.description && (
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">
                        {habit.description}
                      </p>
                    )}

                    <div className="flex items-center gap-4 mt-2">
                      <div
                        className={`flex items-center gap-1.5 text-sm font-medium ${habit.streak > 0 ? "text-orange-500" : "text-gray-600"}`}
                      >
                        <Flame
                          size={16}
                          className={habit.streak > 0 ? "fill-current" : ""}
                        />
                        <span className="font-display">
                          {habit.streak || 0}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 font-mono pt-0.5">
                        Total: {habit.totalCompletions || 0}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditHabit(habit);
                      }}
                      className="w-12 h-12 rounded-xl flex items-center justify-center bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-white transition-colors"
                    >
                      <Edit2 size={20} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteId(habit.id);
                      }}
                      className="w-12 h-12 rounded-xl flex items-center justify-center bg-gray-800 text-gray-500 hover:bg-red-900/20 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>

                    <button
                      onClick={() => handleToggleHabit(habit)}
                      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                        isCompleted
                          ? "bg-green-500 text-white shadow-lg shadow-green-900/20 hover:bg-green-600"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                      }`}
                    >
                      {isCompleted ? (
                        <Undo2 size={20} />
                      ) : (
                        <CheckCircle2 size={24} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const AddHabitModal = ({ onClose, user, appId, showToast, habitToEdit }) => {
  const [title, setTitle] = useState(habitToEdit ? habitToEdit.title : "");
  const [description, setDescription] = useState(
    habitToEdit ? habitToEdit.description : "",
  );
  const [freqType, setFreqType] = useState(
    habitToEdit?.frequency?.type || "daily",
  );
  const [customDays, setCustomDays] = useState(
    habitToEdit?.frequency?.days || [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleDay = (dayIndex) => {
    const dStr = dayIndex.toString();
    if (customDays.includes(dStr)) {
      setCustomDays(customDays.filter((d) => d !== dStr));
    } else {
      setCustomDays([...customDays, dStr]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;
    if (freqType === "custom" && customDays.length === 0) {
      showToast("Select at least one day", "error");
      return;
    }

    setIsSubmitting(true);
    const frequency = {
      type: freqType,
      days: freqType === "custom" ? customDays : [],
    };

    try {
      if (habitToEdit) {
        const habitRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "habits",
          habitToEdit.id,
        );
        await updateDoc(habitRef, { title, description, frequency });
        showToast("Habit updated!", "success");
      } else {
        await addDoc(
          collection(db, "artifacts", appId, "public", "data", "habits"),
          {
            uid: user.uid,
            title,
            description,
            frequency,
            streak: 0,
            lastCompleted: null,
            history: [],
            createdAt: new Date().toISOString(),
            totalCompletions: 0,
          },
        );
        showToast("Habit added!", "success");
      }
      onClose();
    } catch (e) {
      console.error(e);
      showToast("Failed to save habit", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800 shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-4 font-display">
          {habitToEdit ? "Edit Habit" : "New Habit"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
              Title
            </label>
            <input
              autoFocus
              type="text"
              className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-orange-500 focus:outline-none placeholder-gray-700"
              placeholder="e.g., Read for 15 mins"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
              Description (Optional)
            </label>
            <input
              type="text"
              className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-orange-500 focus:outline-none placeholder-gray-700"
              placeholder="e.g., 10 pages of non-fiction"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
              Frequency
            </label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {["daily", "weekly", "monthly", "custom"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFreqType(t)}
                  className={`text-xs font-medium py-2 rounded-lg capitalize transition-colors ${freqType === t ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                >
                  {t}
                </button>
              ))}
            </div>

            {freqType === "custom" && (
              <div className="flex justify-between gap-1">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${customDays.includes(i.toString()) ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-500 hover:bg-gray-700"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl font-medium transition-colors font-display"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-2.5 rounded-xl font-medium transition-colors flex justify-center items-center font-display tracking-wide"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="animate-spin" size={20} />
              ) : habitToEdit ? (
                "Save Changes"
              ) : (
                "Start Tracking"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const SquadView = ({ user, appId, showToast }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [friendHabits, setFriendHabits] = useState([]);

  useEffect(() => {
    const q = query(
      collection(db, "artifacts", appId, "public", "data", "users"),
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const u = snapshot.docs
          .map((d) => d.data())
          .filter((u) => u.uid !== user.uid);
        setUsers(u);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
      },
    );
    return () => unsub();
  }, [appId, user]);

  // Fetch friend habits when expanded
  useEffect(() => {
    let unsub = () => {};
    if (expandedUserId) {
      setFriendHabits([]);
      const q = query(
        collection(db, "artifacts", appId, "public", "data", "habits"),
        where("uid", "==", expandedUserId),
      );
      unsub = onSnapshot(q, (snapshot) => {
        const h = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setFriendHabits(h);
      });
    }
    return () => unsub();
  }, [expandedUserId, appId]);

  const handleUserClick = (friendId) => {
    setExpandedUserId(expandedUserId === friendId ? null : friendId);
  };

  const sendCheer = async (e, friend) => {
    e.stopPropagation();
    try {
      const friendRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "users",
        friend.uid,
      );
      await updateDoc(friendRef, { cheers: increment(1) });

      // Add Notification
      await addDoc(
        collection(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "users",
          friend.uid,
          "notifications",
        ),
        {
          type: "cheer",
          from: user.displayName || "Someone",
          fromUid: user.uid,
          timestamp: new Date().toISOString(),
        },
      );

      showToast(`Cheered ${friend.displayName}!`, "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to send cheer.", "error");
    }
  };

  if (loading)
    return (
      <div className="text-center py-20 text-gray-500">
        <Loader2 className="animate-spin inline mr-2" /> Finding squad...
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center px-1">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight font-display">
            Squad
          </h2>
          <p className="text-gray-400 text-sm">
            Tap a friend to see their habits.
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="text-center py-16 bg-white/5 rounded-3xl border border-white/5 border-dashed">
          <div className="bg-gray-800 inline-block p-4 rounded-full mb-4">
            <Users size={32} className="text-gray-500" />
          </div>
          <p className="text-gray-500">No one else is here yet.</p>
        </div>
      ) : (
        users.map((friend) => (
          <div
            key={friend.uid}
            className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 mb-3 transition-colors"
          >
            <div
              onClick={() => handleUserClick(friend.uid)}
              className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-800/50"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center font-bold text-lg text-white shadow-inner font-display">
                  {friend.displayName
                    ? friend.displayName[0].toUpperCase()
                    : "?"}
                </div>
                <div>
                  <div className="font-bold text-white text-base">
                    {friend.displayName}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-3 mt-1 font-medium">
                    <span className="flex items-center gap-1">
                      <Coins size={12} className="text-yellow-500" />
                      {friend.coins || 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircleHeart size={12} className="text-pink-500" />
                      {friend.cheers || 0} cheers
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => sendCheer(e, friend)}
                  className="bg-pink-500/10 hover:bg-pink-500/20 text-pink-500 p-2.5 rounded-xl transition-colors active:scale-95 border border-pink-500/20"
                  title="Send Cheer"
                >
                  <Zap
                    size={20}
                    className={friend.cheers > 0 ? "fill-current" : ""}
                  />
                </button>
              </div>
            </div>

            {/* Inline Expanded Habits View */}
            {expandedUserId === friend.uid && (
              <div className="px-4 pb-4 pt-0 bg-gray-900 animate-in slide-in-from-top-2">
                <div className="h-px w-full bg-gray-800 mb-3"></div>
                <h4 className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-2 font-display">
                  Today's Habits
                </h4>
                {friendHabits.length === 0 ? (
                  <p className="text-sm text-gray-600 italic">
                    No public habits found.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {friendHabits.map((habit) => {
                      const isCompleted = isHabitCompleted(habit);
                      return (
                        <div
                          key={habit.id}
                          className="flex items-center justify-between bg-gray-950/50 p-2.5 rounded-xl border border-gray-800"
                        >
                          <span
                            className={`text-sm font-medium ${isCompleted ? "text-gray-400 line-through" : "text-gray-200"}`}
                          >
                            {habit.title}
                          </span>
                          {isCompleted ? (
                            <div className="bg-green-500/10 text-green-500 p-1 rounded-full">
                              <Check size={14} strokeWidth={3} />
                            </div>
                          ) : (
                            <div className="bg-gray-800 text-gray-600 p-1 rounded-full">
                              <Circle size={14} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

const LeaderboardView = ({ user, appId, onSelectFriend }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "artifacts", appId, "public", "data", "users"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const allUsers = snap.docs.map((d) => d.data());
        allUsers.sort((a, b) => (b.coins || 0) - (a.coins || 0));
        setUsers(allUsers);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
      },
    );
    return () => unsub();
  }, [appId]);

  if (loading)
    return (
      <div className="text-center py-20 text-gray-500">
        <Loader2 className="animate-spin inline mr-2" /> Loading ranks...
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="text-center py-6">
        <div className="relative inline-block mb-3">
          <Trophy size={40} className="text-yellow-500" />
          <div className="absolute top-0 right-0 w-3 h-3 bg-yellow-400 rounded-full animate-ping"></div>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight font-display">
          Leaderboard
        </h2>
        <p className="text-gray-400 text-sm">Top earners this week.</p>
      </div>

      <div className="bg-gray-900 rounded-3xl overflow-hidden border border-gray-800 shadow-xl">
        {users.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No data yet.</div>
        ) : (
          users.map((u, index) => (
            <div
              key={u.uid}
              onClick={() => u.uid !== user.uid && onSelectFriend(u.uid)}
              className={`flex items-center p-4 border-b border-gray-800 last:border-0 ${u.uid === user.uid ? "bg-white/5 cursor-default" : "cursor-pointer hover:bg-white/5"} transition-colors`}
            >
              <div
                className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold mr-4 text-sm font-display ${index === 0 ? "bg-yellow-500 text-black shadow-lg shadow-yellow-500/20" : index === 1 ? "bg-gray-300 text-black" : index === 2 ? "bg-amber-700 text-white" : "text-gray-600 bg-gray-800"}`}
              >
                {index + 1}
              </div>
              <div className="flex-1">
                <div className="font-bold text-white flex items-center gap-2 text-sm">
                  {u.displayName}
                  {u.uid === user.uid && (
                    <span className="text-[10px] bg-orange-600/20 text-orange-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
                      You
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-gray-600 font-medium uppercase tracking-wide mt-0.5">
                  Joined{" "}
                  {new Date(u.joinedAt).toLocaleDateString(undefined, {
                    month: "short",
                    year: "2-digit",
                  })}
                </div>
              </div>
              <div className="font-mono font-bold text-yellow-500 flex items-center gap-1.5 bg-yellow-500/10 px-2 py-1 rounded-lg">
                {u.coins || 0} <Coins size={12} className="fill-current" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
