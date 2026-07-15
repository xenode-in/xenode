export interface Repository<TEntity, TId, TCreate, TUpdate> {
  findById(id: TId): Promise<TEntity | null>;
  create(input: TCreate): Promise<TEntity>;
  update(id: TId, input: TUpdate): Promise<TEntity | null>;
  delete(id: TId): Promise<boolean>;
}
