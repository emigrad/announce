export type Optional<Obj, keys extends string> = Obj | Omit<Obj, keys>
