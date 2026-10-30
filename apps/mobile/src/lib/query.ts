import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, gcTime: 24 * 60 * 60_000, retry: 1, refetchOnWindowFocus: true },
  },
});

/** Cached reads survive restarts (offline reads, A9). Writes still need the network in 1.0. */
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'circle-cache' });

export async function clearCache() {
  queryClient.clear();
  await AsyncStorage.removeItem('circle-cache');
}
