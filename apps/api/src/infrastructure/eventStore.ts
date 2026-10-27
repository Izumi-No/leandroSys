export class EventStore {
  async save(event: Event): Promise<void> {
    // TODO: implement persistence with EventStoreDB
  }
  async getAll(aggregateId: string): Promise<Event[]> {
    // TODO: implement fetch from EventStoreDB
    return [];
  }
}
