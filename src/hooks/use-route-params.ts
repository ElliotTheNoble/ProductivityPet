import * as ExpoRouter from 'expo-router';

// The search params of the current route as plain strings (the first value when a param is repeated). A router double without params gives {}.
export function useRouteParams(): Record<string, string | undefined> {
  const useParams = (ExpoRouter as { useLocalSearchParams?: () => Record<string, string | string[] | undefined> }).useLocalSearchParams;
  const params = useParams ? useParams() : {};
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params ?? {})) out[key] = Array.isArray(value) ? value[0] : value;
  return out;
}
