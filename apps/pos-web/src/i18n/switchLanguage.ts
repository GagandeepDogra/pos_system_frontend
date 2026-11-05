import type { Language, User } from '@dhaba/shared';
import type { ApiResult } from '../api/client';
import type { endpoints } from '../api/endpoints';
import { setUserLanguage } from './languageStore';

type Api = Pick<ReturnType<typeof endpoints>, 'updateMyLanguage'>;

/**
 * Saves the signed-in user's own language on the server and caches it for that
 * user only. On a stale row_version (409) it refreshes from the returned row
 * and tries once more, since setting a language is safe to repeat.
 */
export async function switchUserLanguage(api: Api, user: User, lang: Language): Promise<ApiResult<User>> {
  let res = await api.updateMyLanguage(user.row_version, lang);
  if (!res.ok && res.status === 409 && res.current) {
    res = await api.updateMyLanguage((res.current as User).row_version, lang);
  }
  if (res.ok) setUserLanguage(user.id, res.data?.language ?? lang);
  return res;
}
