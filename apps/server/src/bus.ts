// ponytail: in-process pub/sub; switch to Postgres LISTEN/NOTIFY when running more than one server.

export type BusMessage =
  | { type: 'invalidate'; groupId: string; entity: string; id?: string }
  | { type: 'message'; groupId: string; message: unknown }
  | { type: 'presence'; groupId: string; room: string; users: string[] }
  | { type: 'membership'; groupId: string };

type Listener = (msg: BusMessage) => void;

export class Bus {
  private groups = new Map<string, Set<Listener>>();
  private users = new Map<string, Set<Listener>>();

  subscribeGroup(groupId: string, fn: Listener) {
    return add(this.groups, groupId, fn);
  }
  subscribeUser(userId: string, fn: Listener) {
    return add(this.users, userId, fn);
  }
  publish(msg: BusMessage) {
    for (const fn of this.groups.get(msg.groupId) ?? []) fn(msg);
  }
  publishUser(userId: string, msg: BusMessage) {
    for (const fn of this.users.get(userId) ?? []) fn(msg);
  }
}

function add(map: Map<string, Set<Listener>>, key: string, fn: Listener) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) map.delete(key);
  };
}
