export interface AuthRepository {
  findByUsername(username: string): Promise<any | null>;
  findById(id: string): Promise<any | null>;
  create(user: { username: string; password: string; role: string }): Promise<any>;
  update(id: string, data: Partial<{ password: string; role: string }>): Promise<any>;
  delete(id: string): Promise<void>;
}
