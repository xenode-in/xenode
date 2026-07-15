import mongoose, {
  type HydratedDocument,
  type Model,
  type Schema,
} from "mongoose";

export function getModel<T>(
  name: string,
  schema: Schema<T>,
): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ??
    mongoose.model<T>(name, schema);
}

export type DatabaseDocument<T> = HydratedDocument<T>;
