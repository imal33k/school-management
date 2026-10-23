import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { api, clearToken, getToken, setToken } from './api.js';

type Role =
  | 'SUPER_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'TEACHER'
  | 'ACCOUNTANT'
  | 'PARENT'
  | 'STUDENT';

type User = {
  id: string;
  email: string;
  role: Role;
  schoolId?: string;
};

type Plan = {
  id: string;
  name: string;
  description?: string;
  price: number | string;
  billingInterval: string;
  maxStudents?: number | null;
  maxTeachers?: number | null;
  maxParents?: number | null;
};

type DashboardData = {
  school?: { name?: string; logoUrl?: string };
  statistics?: Record<string, number>;
  finance?: {
    pendingInvoices?: number;
    paidInvoices?: number;
    revenue?: number;
    failedPayments?: number;
  };
  academic?: { activeSession?: { name?: string; terms?: Array<{ name: string }> } };
  recentAnnouncements?: Array<{
    id: string;
    title: string;
    message?: string;
    publishedAt?: string;
  }>;
  schools?: { total?: number; active?: number; suspended?: number };
  subscriptions?: { active?: number; trial?: number; pastDue?: number };
};

type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[];
  min?: string;
};

type Resource = {
  title: string;
  description: string;
  endpoint: string;
  fields?: Field[];
  columns?: string[];
  search?: boolean;
  detail?: (id: string) => string;
};

const resources: Record<string, Resource> = {
  students: {
    title: 'Students',
    description: 'Keep learner records, admissions and contact details together.',
    endpoint: '/students',
    search: true,
    detail: (id) => `/students/${id}`,
    fields: [
      { name: 'admissionNumber', label: 'Admission number', required: true },
      { name: 'firstName', label: 'First name', required: true },
      { name: 'lastName', label: 'Last name', required: true },
      { name: 'email', label: 'Email address', type: 'email' },
      { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
      { name: 'gender', label: 'Gender', options: ['MALE', 'FEMALE', 'OTHER'] },
      { name: 'phone', label: 'Phone' },
    ],
    columns: ['admissionNumber', 'firstName', 'lastName', 'email', 'status'],
  },
  teachers: {
    title: 'Teachers',
    description: 'Your teaching team and their school profiles.',
    endpoint: '/teachers',
    search: true,
    detail: (id) => `/teachers/${id}`,
    fields: [
      { name: 'firstName', label: 'First name', required: true },
      { name: 'lastName', label: 'Last name', required: true },
      { name: 'employeeId', label: 'Employee ID', required: true },
      { name: 'email', label: 'Email address', type: 'email' },
      { name: 'phone', label: 'Phone' },
    ],
    columns: ['employeeId', 'firstName', 'lastName', 'email', 'phone'],
  },
  parents: {
    title: 'Parents & guardians',
    description: 'Family contacts and linked learners.',
    endpoint: '/parents',
    search: true,
    detail: (id) => `/parents/${id}`,
    columns: ['firstName', 'lastName', 'email', 'phone'],
  },
  classes: {
    title: 'Classes',
    description: 'Organise learners and teaching around your school year.',
    endpoint: '/classes',
    detail: (id) => `/classes/${id}`,
    fields: [
      { name: 'name', label: 'Class name', required: true },
      { name: 'level', label: 'Year or level' },
      { name: 'capacity', label: 'Class capacity', type: 'number', min: '1' },
    ],
    columns: ['name', 'level', 'capacity'],
  },
  subjects: {
    title: 'Subjects',
    description: 'The subjects taught across your school.',
    endpoint: '/subject',
    detail: (id) => `/subject/${id}`,
    fields: [
      { name: 'name', label: 'Subject name', required: true },
      { name: 'code', label: 'Subject code' },
    ],
    columns: ['name', 'code'],
  },
  sessions: {
    title: 'Academic sessions',
    description: 'Set the school year and keep terms within its dates.',
    endpoint: '/academic-sessions',
    detail: (id) => `/academic-sessions/${id}`,
    fields: [
      { name: 'name', label: 'Session name', required: true },
      { name: 'startDate', label: 'Start date', type: 'date', required: true },
      { name: 'endDate', label: 'End date', type: 'date', required: true },
    ],
    columns: ['name', 'startDate', 'endDate', 'isActive'],
  },
  terms: {
    title: 'Terms',
    description: 'Term calendars for the active academic session.',
    endpoint: '/academic-sessions',
    columns: ['name', 'type', 'startDate', 'endDate', 'isActive'],
  },
  attendance: {
    title: 'Attendance',
    description: 'Attendance records for your learners.',
    endpoint: '/attendance',
    detail: (id) => `/attendance/${id}`,
    columns: ['date', 'status', 'studentId', 'classId'],
  },
  examinations: {
    title: 'Examinations',
    description: 'Assessment periods, subjects and examination results.',
    endpoint: '/examinations',
    detail: (id) => `/examinations/${id}`,
    columns: ['name', 'startDate', 'endDate'],
  },
  results: {
    title: 'Results',
    description: 'Academic results and learner performance.',
    endpoint: '/result',
    detail: (id) => `/result/${id}`,
    columns: ['studentId', 'subjectId', 'totalScore', 'grade'],
  },
  timetable: {
    title: 'Timetable',
    description: 'Class schedule and teaching sessions.',
    endpoint: '/timetable',
    detail: (id) => `/timetable/${id}`,
    columns: ['day', 'startTime', 'endTime', 'classId', 'subjectId', 'teacherId'],
  },
  invoices: {
    title: 'Invoices',
    description: 'School fees, balances and payment status.',
    endpoint: '/invoices',
    detail: (id) => `/invoices/${id}`,
    columns: ['invoiceNumber', 'amount', 'amountPaid', 'status', 'dueDate'],
  },
  'fee-structures': {
    title: 'Fee structures',
    description: 'Configure fee items for each term.',
    endpoint: '/fee-structures',
    detail: (id) => `/fee-structures/${id}`,
    columns: ['name', 'amount', 'termId'],
  },
  payments: {
    title: 'Payments',
    description: 'Track incoming school-fee payments.',
    endpoint: '/payments',
    detail: (id) => `/payments/${id}`,
    columns: ['reference', 'amount', 'status', 'paidAt', 'createdAt'],
  },
  announcements: {
    title: 'Announcements',
    description: 'Share important updates with your school community.',
    endpoint: '/announcements',
    detail: (id) => `/announcements/${id}`,
    columns: ['title', 'audience', 'published', 'publishedAt'],
  },
  notifications: {
    title: 'Notifications',
    description: 'Updates and messages sent to your account.',
    endpoint: '/notifications/me',
    columns: ['title', 'message', 'type', 'createdAt'],
  },
  memberships: {
    title: 'School team',
    description: 'Manage who has access to your school.',
    endpoint: '/school-membership',
    columns: ['email', 'role', 'createdAt'],
  },
};

const navGroups: Array<{
  label: string;
  items: Array<{ title: string; path: string; icon: typeof Users; roles: Role[] }>;
}> = [
  {
    label: 'Workspace',
    items: [
      { title: 'Overview', path: '/app', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'PARENT', 'STUDENT'] },
      { title: 'Students', path: '/app/students', icon: GraduationCap, roles: ['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT'] },
      { title: 'Teachers', path: '/app/teachers', icon: Users, roles: ['SCHOOL_ADMIN', 'SUPER_ADMIN'] },
      { title: 'Parents', path: '/app/parents', icon: Users, roles: ['SCHOOL_ADMIN', 'TEACHER'] },
      { title: 'Classes', path: '/app/classes', icon: BookOpen, roles: ['SCHOOL_ADMIN', 'TEACHER'] },
      { title: 'Subjects', path: '/app/subjects', icon: BookOpen, roles: ['SCHOOL_ADMIN', 'TEACHER'] },
    ],
  },
  {
    label: 'Teaching & learning',
    items: [
      { title: 'Academic sessions', path: '/app/sessions', icon: CalendarDays, roles: ['SCHOOL_ADMIN'] },
      { title: 'Attendance', path: '/app/attendance', icon: ClipboardCheck, roles: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'] },
      { title: 'Examinations', path: '/app/examinations', icon: FileText, roles: ['SCHOOL_ADMIN', 'TEACHER'] },
      { title: 'Results', path: '/app/results', icon: Activity, roles: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'] },
      { title: 'Timetable', path: '/app/timetable', icon: CalendarDays, roles: ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT'] },
    ],
  },
  {
    label: 'School office',
    items: [
      { title: 'Invoices', path: '/app/invoices', icon: FileText, roles: ['SCHOOL_ADMIN', 'ACCOUNTANT', 'PARENT', 'STUDENT'] },
      { title: 'Fee structures', path: '/app/fee-structures', icon: CreditCard, roles: ['SCHOOL_ADMIN', 'ACCOUNTANT'] },
      { title: 'Payments', path: '/app/payments', icon: CreditCard, roles: ['SCHOOL_ADMIN', 'ACCOUNTANT'] },
      { title: 'Announcements', path: '/app/announcements', icon: Bell, roles: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'] },
      { title: 'Notifications', path: '/app/notifications', icon: Bell, roles: ['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'PARENT', 'STUDENT'] },
    ],
  },
];

function nameFromPath(path: string) {
  const names: Record<string, string> = {
    '/app/students': 'Students',
    '/app/teachers': 'Teachers',
    '/app/parents': 'Parents',
    '/app/classes': 'Classes',
    '/app/subjects': 'Subjects',
    '/app/sessions': 'Academic sessions',
    '/app/attendance': 'Attendance',
    '/app/examinations': 'Examinations',
    '/app/results': 'Results',
    '/app/timetable': 'Timetable',
    '/app/invoices': 'Invoices',
    '/app/fee-structures': 'Fee structures',
    '/app/payments': 'Payments',
    '/app/announcements': 'Announcements',
    '/app/notifications': 'Notifications',
  };
  return names[path] ?? 'Your school';
}

function displayRole(role: Role) {
  return role.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
}

function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  return <div className="alert alert-error" role="alert">{message}</div>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(Boolean(getToken()));
  const [authError, setAuthError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setBooting(false);
      return;
    }
    try {
      const me = await api<User>('/auth/me');
      setUser(me);
      setAuthError('');
    } catch (error) {
      clearToken();
      setUser(null);
      setAuthError(error instanceof Error ? error.message : 'Could not load your account.');
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener('schoolhouse:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('schoolhouse:unauthorized', handleUnauthorized);
  }, [navigate]);

  const login = async (email: string, password: string) => {
    const result = await api<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(result.access_token);
    const me = await api<User>('/auth/me');
    setUser(me);
    navigate('/app');
  };

  const logout = () => {
    clearToken();
    setUser(null);
    navigate('/login');
  };

  if (booting) {
    return <div className="boot-screen"><div className="brand-mark"><GraduationCap size={20} /></div><span>Getting your school ready…</span></div>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/app" replace /> : <AuthPage mode="login" onLogin={login} />} />
      <Route path="/register" element={user ? <Navigate to="/app" replace /> : <AuthPage mode="register" onLogin={login} />} />
      <Route path="/forgot-password" element={<AuthPage mode="forgot" onLogin={login} />} />
      <Route path="/reset-password" element={<AuthPage mode="reset" onLogin={login} />} />
      <Route path="/accept-invitation" element={<AuthPage mode="invite" onLogin={login} />} />
      <Route
        path="/app/*"
        element={
          user ? (
            <SchoolGate user={user} onComplete={refreshUser}>
              <AppShell
                user={user}
                currentPath={location.pathname}
                onLogout={logout}
                authError={authError}
                onUserRefresh={refreshUser}
              />
            </SchoolGate>
          ) : (
            <Navigate to="/login" replace state={{ from: location }} />
          )
        }
      />
      <Route path="*" element={<Navigate to={user ? '/app' : '/login'} replace />} />
    </Routes>
  );
}

function AuthPage({
  mode,
  onLogin,
}: {
  mode: 'login' | 'register' | 'forgot' | 'reset' | 'invite';
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  const query = new URLSearchParams(window.location.search);
  const token = query.get('token') ?? '';
  const heading =
    mode === 'login'
      ? 'Welcome back'
      : mode === 'register'
        ? 'A better school day starts here'
        : mode === 'forgot'
          ? 'Let’s get you back in'
          : mode === 'reset'
            ? 'Choose a new password'
            : 'You’re invited to join';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      if (mode === 'login') {
        await onLogin(email, password);
      } else if (mode === 'register') {
        await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            firstName: form.get('firstName'),
            lastName: form.get('lastName'),
            phone: form.get('phone') || undefined,
          }),
        });
        await onLogin(email, password);
      } else if (mode === 'forgot') {
        await api('/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        setSuccess('If an account exists for that address, a reset link is on its way.');
      } else if (mode === 'reset') {
        await api('/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token, password }),
        });
        setSuccess('Password changed. You can now sign in.');
        window.setTimeout(() => navigate('/login'), 900);
      } else {
        const result = await api<{ email: string }>('/school-membership/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({
            token,
            password,
            firstName: form.get('firstName'),
            lastName: form.get('lastName'),
            phone: form.get('phone') || undefined,
          }),
        });
        await onLogin(result.email, password);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const isAuthForm = mode === 'login' || mode === 'register';
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link to="/" className="brand brand-light">
          <span className="brand-mark"><GraduationCap size={20} /></span>
          <span>schoolhouse</span>
        </Link>
        <div className="story-copy">
          <span className="eyebrow light-eyebrow"><span className="eyebrow-dot" /> A little more room to focus</span>
          <h1>Good days at school<br /><em>start with good systems.</em></h1>
          <p>Bring the everyday work of your school into one calm, connected place so people can spend more time on what matters.</p>
        </div>
        <div className="story-note">
          <div className="note-avatars"><span>AM</span><span>JT</span><span>SK</span></div>
          <p><strong>Made for the people who make a school.</strong><br />Thoughtful tools for your whole community.</p>
        </div>
        <div className="story-decoration decoration-one" />
        <div className="story-decoration decoration-two" />
      </section>
      <section className="auth-panel">
        <div className="auth-top">
          <Link to="/" className="brand brand-mobile">
            <span className="brand-mark"><GraduationCap size={20} /></span><span>schoolhouse</span>
          </Link>
          <span>Need a hand? Ask your school administrator.</span>
        </div>
        <div className="auth-card">
          <span className="eyebrow">{isAuthForm ? 'YOUR SCHOOL, IN GOOD COMPANY' : 'ACCOUNT HELP'}</span>
          <h2>{heading}</h2>
          <p className="auth-intro">
            {mode === 'login'
              ? 'Sign in to pick up where your school left off.'
              : mode === 'register'
                ? 'Create your administrator account to get started.'
                : mode === 'forgot'
                  ? 'Enter the email you use for schoolhouse and we’ll send a reset link.'
                  : mode === 'reset'
                    ? 'Use at least eight characters for your new password.'
                    : 'Set up your account to accept this school invitation.'}
          </p>
          <ErrorMessage error={error} />
          {success && <div className="alert alert-success"><Check size={16} />{success}</div>}
          <form className="form-stack" onSubmit={submit}>
            {(mode === 'register' || mode === 'invite') && (
              <div className="field-row">
                <label className="field"><span>First name</span><input name="firstName" required minLength={2} autoComplete="given-name" /></label>
                <label className="field"><span>Last name</span><input name="lastName" required minLength={2} autoComplete="family-name" /></label>
              </div>
            )}
            {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
              <label className="field"><span>Email address</span><input type="email" name="email" required autoComplete="email" placeholder="you@school.edu" /></label>
            )}
            {(mode === 'login' || mode === 'register' || mode === 'reset' || mode === 'invite') && (
              <label className="field">
                <span>{mode === 'login' ? 'Password' : 'Create password'}</span>
                <input type="password" name="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" />
              </label>
            )}
            {(mode === 'register' || mode === 'invite') && (
              <label className="field"><span>Phone <small>Optional</small></span><input name="phone" autoComplete="tel" /></label>
            )}
            <button className="button button-primary button-full" disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in to your school' : mode === 'register' ? 'Create administrator account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Save new password' : 'Accept invitation'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </form>
          <div className="auth-links">
            {mode === 'login' && <><Link to="/forgot-password">Forgot password?</Link><span>New to Schoolhouse? <Link to="/register">Create an account</Link></span></>}
            {mode === 'register' && <span>Already have an account? <Link to="/login">Sign in</Link></span>}
            {mode === 'forgot' && <span>Remembered it? <Link to="/login">Back to sign in</Link></span>}
            {(mode === 'reset' || mode === 'invite') && <span>Having trouble? <Link to="/login">Return to sign in</Link></span>}
          </div>
        </div>
        <p className="auth-footnote">A considered space for the work of learning. <span>© 2026 Schoolhouse</span></p>
      </section>
    </main>
  );
}

function AppShell({
  user,
  currentPath,
  onLogout,
  authError,
  onUserRefresh,
}: {
  user: User;
  currentPath: string;
  onLogout: () => void;
  authError: string;
  onUserRefresh: () => Promise<void>;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(user.role)),
    }))
    .filter((group) => group.items.length);

  useEffect(() => {
    if (isSuperAdmin || !user.schoolId) return;
    void api<{ name?: string }>('/schools/me')
      .then((school) => setSchoolName(school.name ?? 'Your school'))
      .catch(() => setSchoolName('Your school'));
  }, [isSuperAdmin, user.schoolId]);

  const title = currentPath === '/app' ? 'Overview' : nameFromPath(currentPath);
  return (
    <div className="app-frame">
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <Link to="/app" className="brand sidebar-brand">
          <span className="brand-mark"><GraduationCap size={20} /></span>
          <span>schoolhouse</span>
        </Link>
        {!isSuperAdmin && (
          <div className="school-switcher">
            <div className="school-monogram">{(schoolName || 'S').charAt(0).toUpperCase()}</div>
            <span className="school-switcher-copy"><strong>{schoolName || 'Your school'}</strong><small>{displayRole(user.role)}</small></span>
            <ChevronDown size={15} />
          </div>
        )}
        <nav className="side-nav">
          {isSuperAdmin ? (
            <div className="nav-section">
              <span className="nav-section-title">Platform</span>
              <NavLinkItem title="Overview" path="/app" icon={LayoutDashboard} active={currentPath === '/app'} onClick={() => setMobileNav(false)} />
              <NavLinkItem title="Schools" path="/app/platform/schools" icon={GraduationCap} active={currentPath.includes('/schools')} onClick={() => setMobileNav(false)} />
              <NavLinkItem title="Plans" path="/app/platform/plans" icon={CreditCard} active={currentPath.includes('/plans')} onClick={() => setMobileNav(false)} />
              <NavLinkItem title="Subscriptions" path="/app/platform/subscriptions" icon={Activity} active={currentPath.includes('/subscriptions')} onClick={() => setMobileNav(false)} />
            </div>
          ) : (
            visibleGroups.map((group) => (
              <div className="nav-section" key={group.label}>
                <span className="nav-section-title">{group.label}</span>
                {group.items.map((item) => (
                  <NavLinkItem
                    key={item.path}
                    title={item.title}
                    path={item.path}
                    icon={item.icon}
                    active={currentPath === item.path}
                    onClick={() => setMobileNav(false)}
                  />
                ))}
              </div>
            ))
          )}
          {(user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN') && (
            <div className="nav-section">
              <span className="nav-section-title">Administration</span>
              {!isSuperAdmin && <NavLinkItem title="School team" path="/app/memberships" icon={Users} active={currentPath.includes('memberships')} onClick={() => setMobileNav(false)} />}
              {!isSuperAdmin && <NavLinkItem title="Subscription" path="/app/billing" icon={CreditCard} active={currentPath.includes('billing')} onClick={() => setMobileNav(false)} />}
              <NavLinkItem title="Settings" path="/app/settings" icon={Settings} active={currentPath.includes('settings')} onClick={() => setMobileNav(false)} />
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={17} /></div><strong>Here if you need us</strong><p>Contact your school administrator for help with your account.</p></div>
          <button className="profile-button" onClick={onLogout}>
            <span className="profile-avatar">{user.email.charAt(0).toUpperCase()}</span>
            <span className="profile-copy"><strong>{user.email.split('@')[0]}</strong><small>{displayRole(user.role)}</small></span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>{isSuperAdmin ? 'Platform' : (schoolName || 'Schoolhouse')}</span><ChevronRight size={14} /><strong>{title}</strong></div>
          <div className="topbar-actions">
            <div className="date-chip"><CalendarDays size={15} /><span>{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span></div>
            <Link className="icon-button notification-button" to="/app/notifications" aria-label="Notifications"><Bell size={18} /></Link>
            <button className="top-avatar" title={user.email}>{user.email.charAt(0).toUpperCase()}</button>
          </div>
        </header>
        <div className="main-content">
          {authError && <div className="alert alert-error">{authError}</div>}
          <Routes>
            <Route path="/" element={<Dashboard user={user} schoolName={schoolName} />} />
            <Route path="/students" element={<ResourcePage resourceKey="students" user={user} />} />
            <Route path="/:resourceKey/:id" element={<DynamicRecordRoute user={user} />} />
            <Route path="/teachers" element={<ResourcePage resourceKey="teachers" user={user} />} />
            <Route path="/parents" element={<ResourcePage resourceKey="parents" user={user} />} />
            <Route path="/classes" element={<ResourcePage resourceKey="classes" user={user} />} />
            <Route path="/subjects" element={<ResourcePage resourceKey="subjects" user={user} />} />
            <Route path="/sessions" element={<AcademicSessions user={user} />} />
            <Route path="/attendance" element={<ResourcePage resourceKey="attendance" user={user} />} />
            <Route path="/examinations" element={<ResourcePage resourceKey="examinations" user={user} />} />
            <Route path="/results" element={<ResourcePage resourceKey="results" user={user} />} />
            <Route path="/timetable" element={<ResourcePage resourceKey="timetable" user={user} />} />
            <Route path="/invoices" element={<ResourcePage resourceKey="invoices" user={user} />} />
            <Route path="/fee-structures" element={<ResourcePage resourceKey="fee-structures" user={user} />} />
            <Route path="/payments" element={<ResourcePage resourceKey="payments" user={user} />} />
            <Route path="/announcements" element={<ResourcePage resourceKey="announcements" user={user} />} />
            <Route path="/notifications" element={<ResourcePage resourceKey="notifications" user={user} />} />
            <Route path="/terms" element={<TermsPage user={user} />} />
            <Route path="/memberships" element={<Memberships user={user} />} />
            <Route path="/billing" element={<Billing user={user} />} />
            <Route path="/settings" element={<SchoolSettings user={user} onUserRefresh={onUserRefresh} />} />
            <Route path="/platform/schools" element={<ResourcePage resourceKey="platform-schools" user={user} />} />
            <Route path="/platform/plans" element={<Plans user={user} />} />
            <Route path="/platform/subscriptions" element={<ResourcePage resourceKey="platform-subscriptions" user={user} />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function NavLinkItem({
  title,
  path,
  icon: Icon,
  active,
  onClick,
}: {
  title: string;
  path: string;
  icon: typeof Users;
  active: boolean;
  onClick: () => void;
}) {
  return <Link to={path} className={`nav-item ${active ? 'nav-item-active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={1.8} /><span>{title}</span></Link>;
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

function Dashboard({ user, schoolName }: { user: User; schoolName: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const superAdmin = user.role === 'SUPER_ADMIN';
  const family = user.role === 'PARENT' || user.role === 'STUDENT';

  useEffect(() => {
    setLoading(true);
    void api<DashboardData>(superAdmin ? '/super-admin/dashboard' : '/dashboard')
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [superAdmin]);

  const statItems = superAdmin
    ? [
        { label: 'Schools on the platform', value: data?.schools?.total ?? '—', icon: GraduationCap, tone: 'sage' },
        { label: 'Active schools', value: data?.schools?.active ?? '—', icon: Check, tone: 'blue' },
        { label: 'Active subscriptions', value: data?.subscriptions?.active ?? '—', icon: CreditCard, tone: 'peach' },
        { label: 'Trials underway', value: data?.subscriptions?.trial ?? '—', icon: Activity, tone: 'lavender' },
      ]
    : family
      ? [
          { label: 'Your profile', value: 'Ready', icon: GraduationCap, tone: 'sage' },
          { label: 'School community', value: schoolName || data?.school?.name || 'Connected', icon: Users, tone: 'blue' },
          { label: 'Learning updates', value: 'View below', icon: BookOpen, tone: 'peach' },
        ]
      : [
          { label: 'Students', value: data?.statistics?.students ?? '—', icon: GraduationCap, tone: 'sage' },
          { label: 'Teaching team', value: data?.statistics?.teachers ?? '—', icon: Users, tone: 'blue' },
          { label: 'Classes', value: data?.statistics?.classes ?? '—', icon: BookOpen, tone: 'peach' },
          { label: 'Fees outstanding', value: data?.finance?.pendingInvoices ?? '—', icon: CreditCard, tone: 'lavender' },
        ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()}
        title={superAdmin ? 'A clear view of your schools.' : `Good morning, ${user.email.split('@')[0]}.`}
        description={superAdmin ? 'Here’s how your school community is doing today.' : `A little overview of what’s happening at ${schoolName || data?.school?.name || 'your school'}.`}
        action={user.role === 'SCHOOL_ADMIN' ? <Link to="/app/students" className="button button-primary"><Plus size={16} /> Add a student</Link> : undefined}
      />
      {Boolean(error) && <ErrorMessage error={error} />}
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="eyebrow light-eyebrow">A fresh start, every day</span>
          <h2>{superAdmin ? 'Growing stronger, together.' : (data?.academic?.activeSession?.name ? `${data.academic.activeSession.name} is underway.` : 'A little space to do your best work.')}</h2>
          <p>{superAdmin ? 'Your platform at a glance, with the people behind the numbers.' : (data?.academic?.activeSession?.terms?.[0]?.name ? `The ${data.academic.activeSession.terms[0].name} is the active term. Keep your school moving at a comfortable pace.` : 'Set up the details that make this school yours. We’ll keep everything in one place.')}</p>
          <Link to={superAdmin ? '/app/platform/schools' : '/app/sessions'} className="banner-link">{superAdmin ? 'Explore schools' : 'View academic calendar'} <ArrowRight size={15} /></Link>
        </div>
        <div className="welcome-art" aria-hidden="true"><span className="art-sun" /><span className="art-hill hill-back" /><span className="art-hill hill-front" /><span className="art-book"><BookOpen size={36} /></span></div>
      </section>
      <section className={`stats-grid ${statItems.length === 3 ? 'stats-three' : ''}`}>
        {statItems.map((item) => {
          const Icon = item.icon;
          return <div className="stat-card" key={item.label}><div className={`stat-icon icon-${item.tone}`}><Icon size={18} /></div><div className="stat-text"><span>{item.label}</span><strong>{loading ? <span className="skeleton-value" /> : item.value}</strong></div><span className="stat-corner"><ArrowUpRight size={15} /></span></div>;
        })}
      </section>
      <div className="dashboard-lower">
        <section className="panel activity-panel">
          <div className="panel-heading"><div><span className="eyebrow">AROUND YOUR SCHOOL</span><h2>Recent announcements</h2></div><Link to="/app/announcements" className="text-link">All updates <ArrowRight size={14} /></Link></div>
          {loading ? <LoadingRows /> : data?.recentAnnouncements?.length ? <div className="announcement-list">{data.recentAnnouncements.map((announcement, index) => <article className="announcement-row" key={announcement.id}><div className={`announcement-marker marker-${index % 3}`}><Bell size={16} /></div><div className="announcement-copy"><strong>{announcement.title}</strong><p>{announcement.message || 'A new update has been shared with your school community.'}</p><time>{announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleDateString() : 'Recently shared'}</time></div><ArrowRight className="announcement-arrow" size={16} /></article>)}</div> : <EmptyState icon={<Bell size={20} />} title="A little quiet around here" body="School updates will appear here as they’re shared." />}
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading"><div><span className="eyebrow">A FEW SHORTCUTS</span><h2>What would you like to do?</h2></div></div>
          <div className="shortcut-list">
            {(user.role === 'SCHOOL_ADMIN'
              ? [
                  { label: 'Bring a new student in', detail: 'Add a learner profile', path: '/app/students', icon: GraduationCap, color: 'sage' },
                  { label: 'Check this week’s classes', detail: 'Open your class list', path: '/app/classes', icon: BookOpen, color: 'blue' },
                  { label: 'Review school payments', detail: 'Fees and balances', path: '/app/invoices', icon: CreditCard, color: 'peach' },
                ]
              : user.role === 'SUPER_ADMIN'
                ? [
                    { label: 'See all schools', detail: 'Platform directory', path: '/app/platform/schools', icon: GraduationCap, color: 'sage' },
                    { label: 'Review subscriptions', detail: 'Billing overview', path: '/app/platform/subscriptions', icon: CreditCard, color: 'blue' },
                    { label: 'Manage plans', detail: 'Pricing and limits', path: '/app/platform/plans', icon: ShieldCheck, color: 'peach' },
                  ]
                : [
                    { label: 'Check your timetable', detail: 'See the school week', path: '/app/timetable', icon: CalendarDays, color: 'sage' },
                    { label: 'View recent results', detail: 'Learning progress', path: '/app/results', icon: BookOpen, color: 'blue' },
                    { label: 'Read announcements', detail: 'Stay in the loop', path: '/app/announcements', icon: Bell, color: 'peach' },
                  ]).map((shortcut) => {
              const Icon = shortcut.icon;
              return <Link className="shortcut-row" to={shortcut.path} key={shortcut.label}><span className={`shortcut-icon icon-${shortcut.color}`}><Icon size={17} /></span><span><strong>{shortcut.label}</strong><small>{shortcut.detail}</small></span><ArrowRight size={15} /></Link>;
            })}
          </div>
          {!superAdmin && data?.finance && <div className="revenue-note"><div className="revenue-head"><span>Collected so far</span><span className="revenue-trend"><ArrowUpRight size={13} /> This term</span></div><strong>{new Intl.NumberFormat('en', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(data.finance.revenue ?? 0)}</strong><p>Across {data.finance.paidInvoices ?? 0} settled invoices</p></div>}
        </section>
      </div>
      {user.role === 'SCHOOL_ADMIN' && <SubscriptionNudge />}
    </div>
  );
}

function SubscriptionNudge() {
  const [subscription, setSubscription] = useState<{ status: string; endDate: string } | null>(null);
  useEffect(() => {
    void api<{ status: string; endDate: string }>('/subscriptions/me')
      .then(setSubscription)
      .catch(() => setSubscription(null));
  }, []);
  if (!subscription) return null;
  const remainingDays = Math.ceil((new Date(subscription.endDate).getTime() - Date.now()) / 86_400_000);
  if (remainingDays > 7) return null;
  return <div className="subscription-nudge"><div className="nudge-icon"><CreditCard size={18} /></div><div><strong>{subscription.status === 'TRIAL' ? 'Your trial is nearly up' : 'A billing date is coming up'}</strong><p>{remainingDays <= 0 ? 'Review your subscription to keep school features available.' : `${remainingDays} day${remainingDays === 1 ? '' : 's'} left in this period. Review your plan when you’re ready.`}</p></div><Link to="/app/billing" className="text-link">Review plan <ArrowRight size={14} /></Link></div>;
}

function LoadingRows() {
  return <div className="loading-rows"><span /><span /><span /></div>;
}

function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{body}</p>{action}</div>;
}

function ResourcePage({ resourceKey, user }: { resourceKey: string; user: User }) {
  const { id } = useParams();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const navigate = useNavigate();
  const config = useMemo<Resource>(() => resourceKey === 'platform-schools'
    ? { title: 'Schools', description: 'Schools using your platform, all in one view.', endpoint: '/schools', columns: ['name', 'slug', 'status', 'createdAt'], detail: (itemId: string) => `/schools/${itemId}` }
    : resourceKey === 'platform-subscriptions'
      ? { title: 'Subscriptions', description: 'Keep an eye on trials, renewals and school plans.', endpoint: '/subscriptions', columns: ['schoolId', 'planId', 'status', 'startDate', 'endDate'], detail: (itemId: string) => `/subscriptions/${itemId}` }
      : resources[resourceKey] ?? resources.students, [resourceKey]);
  const endpoint = config.endpoint === '/school-membership' && user.schoolId
    ? `/school-membership/school/${user.schoolId}`
    : config.endpoint;
  const isMine = ['notifications', 'students', 'parents', 'invoices', 'results', 'attendance'].includes(resourceKey) && (user.role === 'PARENT' || user.role === 'STUDENT');
  const finalEndpoint = isMine && resources[resourceKey].endpoint !== '/notifications/me'
    ? `${resources[resourceKey].endpoint}/me`
    : endpoint;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (id && config.detail) {
      void api<Record<string, unknown>>(config.detail(id))
        .then((item) => { if (active) setData([item]); })
        .catch((loadError) => { if (active) setError(loadError); })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (query && config.search) params.set('search', query);
    void api<unknown>(`${finalEndpoint}?${params.toString()}`)
      .then((result) => {
        if (!active) return;
        if (Array.isArray(result)) {
          setData(result as Record<string, unknown>[]);
          setMeta({ total: result.length, totalPages: 1 });
        } else if (result && typeof result === 'object') {
          const response = result as { data?: unknown[]; meta?: { total?: number; totalPages?: number } };
          setData(Array.isArray(response.data) ? response.data as Record<string, unknown>[] : []);
          setMeta({ total: response.meta?.total ?? 0, totalPages: response.meta?.totalPages ?? 1 });
        } else {
          setData([result as Record<string, unknown>]);
        }
      })
      .catch((loadError) => { if (active) setError(loadError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [config, finalEndpoint, id, page, query, refresh, resourceKey]);

  const fields = config.columns ?? Object.keys(data[0] ?? {}).filter((key) => !['id', 'schoolId', 'userId', 'createdAt', 'updatedAt'].includes(key)).slice(0, 5);
  const canCreate = !!config.fields && (
    ['SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(user.role) ||
    (resourceKey === 'attendance' && user.role === 'TEACHER')
  );
  const title = config.title;

  if (id && data[0]) return <RecordDetail item={data[0]} title={title} onBack={() => navigate(-1)} />;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SCHOOL DIRECTORY"
        title={title}
        description={config.description}
        action={canCreate ? <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Add {title.slice(0, -1).toLowerCase()}</button> : undefined}
      />
      {Boolean(error) && <ErrorMessage error={error} />}
      <section className="panel directory-panel">
        <div className="directory-toolbar">
          <div className="directory-count"><strong>{meta.total}</strong> {title.toLowerCase()}<span>·</span> Keep your records up to date</div>
          {config.search && <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`Search ${title.toLowerCase()}…`} /><kbd>⌘ K</kbd></label>}
          {!config.search && <button className="icon-button" title="More options"><MoreHorizontal size={19} /></button>}
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>{fields.map((field) => <th key={field}>{humanize(field)}</th>)}<th aria-label="Actions" /></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={fields.length + 1}><LoadingRows /></td></tr>}
              {!loading && data.map((item, index) => (
                <tr key={String(item.id ?? index)} onClick={() => item.id && config.detail && navigate(`/app/${resourceKey}/${String(item.id)}`)}>
                  {fields.map((field) => <td key={field}>{renderCell(item[field], field)}</td>)}
                  <td className="table-action"><button className="icon-button" aria-label={`View ${title.slice(0, -1)}`} onClick={(event) => { event.stopPropagation(); if (item.id && config.detail) navigate(`/app/${resourceKey}/${String(item.id)}`); }}><ArrowRight size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data.length === 0 && !error && <EmptyState icon={<BookOpen size={19} />} title={`No ${title.toLowerCase()} yet`} body="There’s nothing to show here just yet. New records will appear here when they’re added." action={canCreate ? <button className="button button-outline" onClick={() => setShowCreate(true)}><Plus size={15} /> Add the first one</button> : undefined} />}
        </div>
        <div className="table-footer"><span>Showing {data.length ? (page - 1) * 20 + 1 : 0}–{(page - 1) * 20 + data.length} of {meta.total}</span><div className="pagination"><button className="icon-button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page"><ChevronLeft size={16} /></button><span>Page {page} of {meta.totalPages}</span><button className="icon-button" disabled={page >= meta.totalPages} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></div>
      </section>
      {showCreate && config.fields && <CreateRecordModal title={title} endpoint={config.endpoint} fields={config.fields} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); setRefresh((value) => value + 1); }} />}
    </div>
  );
}

function RecordDetail({ item, title, onBack }: { item: Record<string, unknown>; title: string; onBack: () => void }) {
  return <div className="page-stack"><PageHeader eyebrow={title.toUpperCase()} title={String(item.name ?? item.title ?? `${title.slice(0, -1)} details`)} description="A closer look at this school record." action={<button className="button button-outline" onClick={onBack}><ChevronLeft size={16} /> Back to list</button>} /><section className="panel detail-panel"><div className="detail-grid">{Object.entries(item).filter(([key]) => !['id', 'schoolId'].includes(key)).map(([key, value]) => <div className="detail-item" key={key}><span>{humanize(key)}</span><strong>{renderCell(value, key)}</strong></div>)}</div></section></div>;
}

function CreateRecordModal({
  title,
  endpoint,
  fields,
  onClose,
  onCreated,
}: {
  title: string;
  endpoint: string;
  fields: Field[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    fields.forEach((field) => {
      const value = form.get(field.name);
      if (value !== null && value !== '') {
        body[field.name] = field.type === 'number' ? Number(value) : value;
      }
    });
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      onCreated();
    } catch (submitError) {
      setError(submitError);
    } finally {
      setBusy(false);
    }
  }
  const recordName = title.endsWith('s') ? title.slice(0, -1) : title;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="eyebrow">NEW SCHOOL RECORD</span><h2 id="modal-title">Add {recordName.toLowerCase()}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><form onSubmit={submit}><div className="modal-fields">{fields.map((field) => <label className="field" key={field.name}><span>{field.label}{field.required && <i> *</i>}</span>{field.options ? <select name={field.name} required={field.required}><option value="">Choose one</option>{field.options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}</select> : <input name={field.name} type={field.type ?? 'text'} required={field.required} min={field.min} minLength={field.type === 'text' ? 2 : undefined} />}</label>)}</div><ErrorMessage error={error} /><div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? <span className="spinner" /> : <Plus size={16} />}{busy ? 'Saving…' : 'Save record'}</button></div></form></section></div>;
}

function AcademicSessions({ user }: { user: User }) {
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [create, setCreate] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    void api<Record<string, unknown>[]>('/academic-sessions')
      .then(setSessions)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [refresh]);
  async function activate(id: string) {
    setError(null);
    try {
      await api(`/academic-sessions/${id}/activate`, { method: 'POST' });
      setRefresh((value) => value + 1);
    } catch (activateError) {
      setError(activateError);
    }
  }
  return <div className="page-stack"><PageHeader eyebrow="SCHOOL CALENDAR" title="Academic sessions" description="One school year at a time. Keep every term in its right place." action={user.role === 'SCHOOL_ADMIN' ? <button className="button button-primary" onClick={() => setCreate(true)}><Plus size={16} /> New session</button> : undefined} />{Boolean(error) && <ErrorMessage error={error} />}<div className="session-list">{loading ? <LoadingRows /> : sessions.map((session) => <article className={`session-card ${session.isActive ? 'session-active' : ''}`} key={String(session.id)}><div className="session-date"><CalendarDays size={18} /><span>{new Date(String(session.startDate)).getFullYear()}<small>ACADEMIC YEAR</small></span></div><div className="session-body"><div className="session-title"><h2>{String(session.name)}</h2>{Boolean(session.isActive) && <span className="status-pill status-active"><span /> Active now</span>}</div><p>{new Date(String(session.startDate)).toLocaleDateString()} — {new Date(String(session.endDate)).toLocaleDateString()}</p><div className="session-terms">{(Array.isArray(session.terms) ? session.terms : []).map((term) => <span key={String((term as Record<string, unknown>).id)}>{String((term as Record<string, unknown>).name)}</span>)}</div><Link className="text-link session-term-link" to={`/app/terms?sessionId=${session.id}`}>Manage terms <ArrowRight size={13} /></Link></div><div className="session-actions">{!session.isActive && user.role === 'SCHOOL_ADMIN' && <button className="button button-outline" onClick={() => void activate(String(session.id))}>Make active</button>}<Link className="icon-button" to={`/app/sessions/${session.id}`} aria-label="View session"><ArrowRight size={16} /></Link></div></article>)}{!loading && !sessions.length && <section className="panel"><EmptyState icon={<CalendarDays size={20} />} title="Your school year starts here" body="Create an academic session, then add terms that fit within its dates." action={user.role === 'SCHOOL_ADMIN' ? <button className="button button-primary" onClick={() => setCreate(true)}><Plus size={15} /> Create session</button> : undefined} /></section>}</div>{create && <CreateRecordModal title="Academic session" endpoint="/academic-sessions" fields={resources.sessions.fields!} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); setRefresh((value) => value + 1); }} />}</div>;
}

function TermsPage({ user }: { user: User }) {
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const [sessionId, setSessionId] = useState(
    new URLSearchParams(window.location.search).get('sessionId') ?? '',
  );
  const [terms, setTerms] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [create, setCreate] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    void api<Record<string, unknown>[]>('/academic-sessions')
      .then((rows) => {
        setSessions(rows);
        if (!sessionId) {
          const active = rows.find((row) => row.isActive) ?? rows[0];
          if (active?.id) setSessionId(String(active.id));
        }
      })
      .catch(setError);
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId) {
      setTerms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void api<Record<string, unknown>[]>(`/academic-sessions/${sessionId}/terms`)
      .then(setTerms)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [sessionId, refresh]);
  const selectedSession = sessions.find((session) => session.id === sessionId);

  async function activate(termId: string) {
    setError(null);
    try {
      await api(`/terms/${termId}/activate`, { method: 'POST' });
      setRefresh((value) => value + 1);
    } catch (activateError) {
      setError(activateError);
    }
  }

  return <div className="page-stack"><PageHeader eyebrow="SCHOOL CALENDAR" title="Terms" description="Set the rhythm of the school year, one term at a time." action={user.role === 'SCHOOL_ADMIN' && sessionId ? <button className="button button-primary" onClick={() => setCreate(true)}><Plus size={16} /> Add term</button> : undefined} />{Boolean(error) && <ErrorMessage error={error} />}<section className="term-session-select"><label className="field"><span>Academic session</span><select value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Choose a session</option>{sessions.map((session) => <option value={String(session.id)} key={String(session.id)}>{String(session.name)}{session.isActive ? ' · Active' : ''}</option>)}</select></label>{selectedSession && <span className="term-session-dates">{new Date(String(selectedSession.startDate)).toLocaleDateString()} — {new Date(String(selectedSession.endDate)).toLocaleDateString()}</span>}</section><section className="panel directory-panel"><div className="table-scroll"><table className="data-table"><thead><tr>{['name', 'type', 'startDate', 'endDate', 'isActive'].map((key) => <th key={key}>{humanize(key)}</th>)}<th /></tr></thead><tbody>{loading && <tr><td colSpan={6}><LoadingRows /></td></tr>}{!loading && terms.map((term) => <tr key={String(term.id)}>{['name', 'type', 'startDate', 'endDate', 'isActive'].map((key) => <td key={key}>{renderCell(term[key], key)}</td>)}<td className="table-action">{user.role === 'SCHOOL_ADMIN' && !term.isActive && <button className="button button-quiet" onClick={() => void activate(String(term.id))}>Make active</button>}</td></tr>)}</tbody></table>{!loading && !terms.length && <EmptyState icon={<CalendarDays size={20} />} title="No terms in this session" body="Add your first term. Its dates must sit within this academic session." action={user.role === 'SCHOOL_ADMIN' && sessionId ? <button className="button button-primary" onClick={() => setCreate(true)}><Plus size={15} /> Add term</button> : undefined} />}</div></section>{create && selectedSession && <CreateRecordModal title="Term" endpoint={`/academic-sessions/${sessionId}/terms`} fields={[{ name: 'name', label: 'Term name', required: true }, { name: 'type', label: 'Term type', required: true, options: ['FIRST', 'SECOND', 'THIRD'] }, { name: 'startDate', label: 'Start date', type: 'date', required: true }, { name: 'endDate', label: 'End date', type: 'date', required: true }]} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); setRefresh((value) => value + 1); }} />}</div>;
}

function DynamicRecordRoute({ user }: { user: User }) {
  const { resourceKey } = useParams();
  const key = resourceKey ?? '';
  if (!resources[key] && !['platform-schools', 'platform-subscriptions'].includes(key)) {
    return <Navigate to="/app" replace />;
  }
  return <ResourcePage resourceKey={key} user={user} />;
}

function Billing({ user }: { user: User }) {
  const [subscription, setSubscription] = useState<Record<string, unknown> | null>(null);
  const [payments, setPayments] = useState<Record<string, unknown>[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busyPlan, setBusyPlan] = useState('');
  const superAdmin = user.role === 'SUPER_ADMIN';
  useEffect(() => {
    void Promise.all([
      api<Record<string, unknown>>('/subscriptions/me').catch(() => null),
      api<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>('/subscriptions/me/payments?page=1&limit=10').catch(() => []),
      api<Plan[]>('/plans/active').catch(() => []),
    ]).then(([sub, history, available]) => {
      setSubscription(sub);
      setPayments(Array.isArray(history) ? history : history?.data ?? []);
      setPlans(available);
    });
  }, []);

  async function startCheckout(plan: Plan) {
    setError(null);
    setBusyPlan(plan.id);
    try {
      let current = subscription;
      if (!current) {
        current = await api<Record<string, unknown>>('/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ planId: plan.id }),
        });
        setSubscription(current);
      }
      const checkout = await api<{ authorizationUrl: string }>(`/subscriptions/${current.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ planId: plan.id, callbackUrl: `${window.location.origin}/app/billing` }),
      });
      window.location.assign(checkout.authorizationUrl);
    } catch (checkoutError) {
      setError(checkoutError);
    } finally {
      setBusyPlan('');
    }
  }

  if (superAdmin) return <Navigate to="/app/platform/subscriptions" replace />;
  return <div className="page-stack"><PageHeader eyebrow="YOUR SCHOOL PLAN" title="Billing, without the busywork." description="Your plan, payment history and next steps in one place." />{Boolean(error) && <ErrorMessage error={error} />}<section className="billing-hero"><div><span className="eyebrow light-eyebrow">CURRENT SUBSCRIPTION</span><h2>{subscription ? String((subscription.plan as Record<string, unknown> | undefined)?.name ?? 'Your school plan') : 'A plan for your school'}</h2><p>{subscription ? `${humanize(String(subscription.status ?? 'TRIAL'))} · renews ${subscription.endDate ? new Date(String(subscription.endDate)).toLocaleDateString() : 'on your plan date'}` : 'Choose a plan to start your trial and unlock your school workspace.'}</p></div><div className="billing-seal"><ShieldCheck size={25} /><span>Simple<br />school billing</span></div></section><section className="plan-grid">{plans.map((plan, index) => <article className={`plan-card ${index === 1 ? 'plan-featured' : ''}`} key={plan.id}><span className="plan-tag">{index === 1 ? 'A GOOD FIT FOR GROWING SCHOOLS' : 'SCHOOL PLAN'}</span><h3>{plan.name}</h3><p>{plan.description || 'The essentials for a smooth-running school.'}</p><div className="plan-price"><strong>{formatCurrency(Number(plan.price))}</strong><span>/{plan.billingInterval.toLowerCase()}</span></div><ul>{[[plan.maxStudents, 'students'], [plan.maxTeachers, 'teachers'], [plan.maxParents, 'parents']].map(([limit, label]) => limit ? <li key={String(label)}><Check size={15} /> Up to {limit} {label}</li> : null)}</ul><button className={index === 1 ? 'button button-primary button-full' : 'button button-outline button-full'} disabled={!!busyPlan} onClick={() => void startCheckout(plan)}>{busyPlan === plan.id ? <span className="spinner" /> : null}{busyPlan === plan.id ? 'Opening secure checkout…' : subscription ? 'Choose this plan' : 'Start with this plan'} <ArrowRight size={15} /></button></article>)}</section><section className="panel payment-history"><div className="panel-heading"><div><span className="eyebrow">PAYMENT HISTORY</span><h2>Receipts and renewals</h2></div></div>{payments.length ? <div className="history-list">{payments.map((payment) => <div className="history-row" key={String(payment.id)}><span className="history-icon"><CreditCard size={16} /></span><span className="history-main"><strong>{String(payment.reference)}</strong><small>{payment.createdAt ? new Date(String(payment.createdAt)).toLocaleDateString() : 'Recent'}</small></span><strong>{formatCurrency(Number(payment.amount))}</strong><span className={`status-pill status-${String(payment.status).toLowerCase()}`}>{humanize(String(payment.status))}</span></div>)}</div> : <EmptyState icon={<CreditCard size={20} />} title="No payments just yet" body="Your plan receipts will be kept here for easy reference." />}</section></div>;
}

function Plans({ user }: { user: User }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [create, setCreate] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    void api<Plan[]>(user.role === 'SUPER_ADMIN' ? '/plans' : '/plans/active')
      .then(setPlans)
      .catch(setError);
  }, [user.role, refresh]);
  const createPlanFields: Field[] = [
    { name: 'name', label: 'Plan name', required: true },
    { name: 'description', label: 'Description' },
    { name: 'price', label: 'Price (NGN)', type: 'number', required: true, min: '0' },
    { name: 'billingInterval', label: 'Billing interval', required: true, options: ['MONTHLY', 'TERMLY', 'YEARLY'] },
    { name: 'maxStudents', label: 'Maximum students', type: 'number', min: '1' },
    { name: 'maxTeachers', label: 'Maximum teachers', type: 'number', min: '1' },
    { name: 'maxParents', label: 'Maximum parents', type: 'number', min: '1' },
  ];
  return <div className="page-stack"><PageHeader eyebrow="PLATFORM" title="Plans for every season." description="A clear view of the options schools can choose from." action={user.role === 'SUPER_ADMIN' ? <button className="button button-primary" onClick={() => setCreate(true)}><Plus size={16} /> Create a plan</button> : undefined} />{Boolean(error) && <ErrorMessage error={error} />}<section className="panel directory-panel"><div className="directory-toolbar"><div className="directory-count"><strong>{plans.length}</strong> available plans</div></div><div className="plan-admin-list">{plans.map((plan) => <article className="plan-admin-row" key={plan.id}><div className="plan-admin-icon"><CreditCard size={17} /></div><div><strong>{plan.name}</strong><small>{plan.description || 'No description added'}</small></div><b>{formatCurrency(Number(plan.price))}<small> / {plan.billingInterval.toLowerCase()}</small></b><span className="limit-tags">{plan.maxStudents && <i>{plan.maxStudents} students</i>}{plan.maxTeachers && <i>{plan.maxTeachers} teachers</i>}</span></article>)}</div>{!plans.length && <EmptyState icon={<CreditCard size={19} />} title="Plans will appear here" body="Active subscription plans will be available for schools to review." />}</section>{create && <CreateRecordModal title="Plan" endpoint="/plans" fields={createPlanFields} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); setRefresh((value) => value + 1); }} />}</div>;
}

function Memberships({ user }: { user: User }) {
  const [members, setMembers] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!user.schoolId) return;
    void api<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>(`/school-membership/school/${user.schoolId}?page=1&limit=50`)
      .then((response) => setMembers(Array.isArray(response) ? response : response.data ?? []))
      .catch(setError);
  }, [user.schoolId]);
  return <div className="page-stack"><PageHeader eyebrow="SCHOOL ADMINISTRATION" title="The people behind the school." description="See who has access and which part they play." action={<InviteMember />} />{Boolean(error) && <ErrorMessage error={error} />}<section className="panel directory-panel"><div className="directory-toolbar"><div className="directory-count"><strong>{members.length}</strong> team members</div></div><div className="team-list">{members.map((member) => { const person = member.user as Record<string, unknown> | undefined; return <div className="team-row" key={String(member.id)}><span className="profile-avatar">{String(person?.firstName ?? person?.email ?? '?').charAt(0).toUpperCase()}</span><div className="team-person"><strong>{`${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim() || String(person?.email ?? 'School member')}</strong><small>{String(person?.email ?? '')}</small></div><span className="role-pill">{displayRole((member.role ?? person?.role) as Role)}</span><span className="team-since">{member.createdAt ? new Date(String(member.createdAt)).toLocaleDateString() : ''}</span></div>; })}</div>{!members.length && <EmptyState icon={<Users size={20} />} title="Your team will show up here" body="Invite the teachers and school staff who keep the day moving." />}</section></div>;
}

function InviteMember() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get('email'),
      role: form.get('role'),
      employeeId: form.get('employeeId') || undefined,
      admissionNumber: form.get('admissionNumber') || undefined,
    };
    try {
      await api('/school-membership/invitations', { method: 'POST', body: JSON.stringify(payload) });
      setOpen(false);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Invitation could not be sent.');
    } finally {
      setBusy(false);
    }
  }
  return <><button className="button button-primary" onClick={() => setOpen(true)}><Plus size={16} /> Invite someone</button>{open && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="eyebrow">GROW YOUR TEAM</span><h2>Send an invitation</h2></div><button className="icon-button" onClick={() => setOpen(false)}><X size={18} /></button></div><p className="modal-description">They’ll receive a personal link to set up their account. Invites are available for staff, parents and students.</p><form onSubmit={submit}><div className="modal-fields"><label className="field"><span>Email address</span><input type="email" name="email" required /></label><label className="field"><span>Role</span><select name="role" required><option value="">Choose a role</option><option value="TEACHER">Teacher</option><option value="ACCOUNTANT">Accountant</option><option value="PARENT">Parent</option><option value="STUDENT">Student</option></select></label><label className="field"><span>Employee ID <small>For teachers</small></span><input name="employeeId" /></label><label className="field"><span>Admission number <small>For students</small></span><input name="admissionNumber" /></label></div>{Boolean(error) && <ErrorMessage error={error} />}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'} <ArrowRight size={15} /></button></div></form></section></div>}</>;
}

function SchoolSettings({ user, onUserRefresh }: { user: User; onUserRefresh: () => Promise<void> }) {
  const [school, setSchool] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<Record<string, string>>('/schools/me').then(setSchool).catch((loadError) => setError(loadError.message));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      await api('/schools/me', { method: 'PATCH', body: JSON.stringify(body) });
      setSuccess('Your school details are up to date.');
      await onUserRefresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }
  if (user.role === 'SUPER_ADMIN') return <div className="page-stack"><PageHeader title="Platform settings" description="Account and platform access." /><section className="panel setting-card"><span className="eyebrow">SIGNED IN AS</span><h2>{user.email}</h2><p>Your platform account is protected by your sign-in credentials.</p></section></div>;
  return <div className="page-stack"><PageHeader eyebrow="SCHOOL ADMINISTRATION" title="The details that make you, you." description="Keep your school information current for your community." /><section className="panel settings-panel"><div className="settings-section-title"><span className="settings-icon"><GraduationCap size={18} /></span><div><h2>School profile</h2><p>How your school appears across the workspace.</p></div></div>{Boolean(error) && <ErrorMessage error={error} />}{success && <div className="alert alert-success"><Check size={16} />{success}</div>}<form className="settings-form" onSubmit={submit}><label className="field"><span>School name</span><input name="name" defaultValue={school.name} required maxLength={150} /></label><div className="field-row"><label className="field"><span>Contact email</span><input name="email" type="email" defaultValue={school.email} /></label><label className="field"><span>Phone number</span><input name="phone" defaultValue={school.phone} /></label></div><label className="field"><span>School address</span><input name="address" defaultValue={school.address} /></label><div className="field-row"><label className="field"><span>Website</span><input name="website" type="url" defaultValue={school.website} /></label><label className="field"><span>School logo URL</span><input name="logoUrl" type="url" defaultValue={school.logoUrl} /></label></div><div className="settings-actions"><span><ShieldCheck size={15} /> Only school administrators can change these details.</span><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'} <ArrowRight size={15} /></button></div></form></section></div>;
}

function Onboarding({ onComplete }: { onComplete: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      await api('/onboarding/school', { method: 'POST', body: JSON.stringify(body) });
      await onComplete();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not set up your school.');
    } finally {
      setBusy(false);
    }
  }
  return <div className="onboarding-page"><Link to="/app" className="brand"><span className="brand-mark"><GraduationCap size={20} /></span><span>schoolhouse</span></Link><div className="onboarding-card"><span className="onboarding-illustration"><BookOpen size={27} /></span><span className="eyebrow">FIRST, THE IMPORTANT THINGS</span><h1>Let’s make this space yours.</h1><p>A few details now will make everything feel more like your school.</p>{Boolean(error) && <ErrorMessage error={error} />}<form className="form-stack" onSubmit={submit}><label className="field"><span>School name</span><input name="name" required minLength={2} placeholder="e.g. Cedar Grove School" /></label><label className="field"><span>School email <small>Optional</small></span><input name="email" type="email" placeholder="hello@your-school.edu" /></label><div className="field-row"><label className="field"><span>Phone <small>Optional</small></span><input name="phone" /></label><label className="field"><span>Website <small>Optional</small></span><input name="website" type="url" placeholder="https://" /></label></div><label className="field"><span>Address <small>Optional</small></span><input name="address" /></label><button className="button button-primary button-full" disabled={busy}>{busy ? 'Setting up…' : 'Create my school'} <ArrowRight size={16} /></button></form></div><p className="onboarding-foot">Your school workspace is just getting started.</p></div>;
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderCell(value: unknown, key: string) {
  if (value === null || value === undefined || value === '') return <span className="muted-cell">—</span>;
  if (typeof value === 'boolean') return <span className={`status-pill ${value ? 'status-active' : 'status-inactive'}`}><span />{value ? 'Yes' : 'No'}</span>;
  if (key.toLowerCase().includes('status')) return <span className={`status-pill status-${String(value).toLowerCase()}`}><span />{humanize(String(value))}</span>;
  if (key.toLowerCase().includes('date') || key.endsWith('At')) {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  }
  if (typeof value === 'object') return '—';
  if (key.toLowerCase().includes('amount') || key.toLowerCase() === 'revenue') return formatCurrency(Number(value));
  return String(value);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0);
}

function SchoolGate({ user, children, onComplete }: { user: User; children: ReactNode; onComplete: () => Promise<void> }) {
  if (user.role !== 'SUPER_ADMIN' && !user.schoolId) return <Onboarding onComplete={onComplete} />;
  return <>{children}</>;
}

export default function AppWithSchoolGate() {
  return <App />;
}
