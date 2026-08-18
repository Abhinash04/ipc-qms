import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import LogInIcon from 'lucide-react/dist/esm/icons/log-in.mjs';

import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MOCK_USERS, MOCK_PASSWORD, findUserByEmail } from '@/constants/mockUsers';
import { ROLE_LABELS } from '@/constants/roles';
import { roleHome } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';

export function LoginPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  if (currentUser) return <Navigate to={roleHome(currentUser.role)} replace />;

  const applyCredentials = (user) => {
    setEmail(user.email);
    setPassword(MOCK_PASSWORD);
    setError(null);
  };

  const submit = (event) => {
    event.preventDefault();
    const user = findUserByEmail(email);

    if (!user || password !== MOCK_PASSWORD) {
      setError('Incorrect email or password.');
      return;
    }

    login(user.id);
    navigate(roleHome(user.role), { replace: true });
  };

  return (
    <div className="grid w-full max-w-4xl grid-cols-1 gap-6 p-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Query Management System
          </p>
          <h1 className="mt-1 text-lg font-semibold text-foreground">Sign in</h1>
        </CardHeader>
        <CardBody>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@ipc.example"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-status-red-fg">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full">
              <LogInIcon aria-hidden="true" />
              Login
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground">Mock Credentials</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Development users. Every account uses the password{' '}
            <span className="font-medium text-foreground">{MOCK_PASSWORD}</span>.
          </p>
        </CardHeader>
        <CardBody className="space-y-2">
          {MOCK_USERS.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                <Badge variant="secondary" className="mt-1">
                  {ROLE_LABELS[user.role]}
                </Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyCredentials(user)}
              >
                Use Credentials
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
