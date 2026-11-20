import { createContext, useContext } from 'react';
import type { CurrentUser } from '@rs/shared';

export interface UserContextValue {
  user: CurrentUser;
  /** Обновить данные вошедшего (после смены пароля и т. п.). */
  setUser: (user: CurrentUser) => void;
  logout: () => Promise<void>;
}

export const UserContext = createContext<UserContextValue | null>(null);

/** Вошедший пользователь; доступен везде внутри `AuthGate`. */
export function useUser(): UserContextValue {
  const value = useContext(UserContext);
  if (!value) throw new Error('useUser вызван вне AuthGate');
  return value;
}
