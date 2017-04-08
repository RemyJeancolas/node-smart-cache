export interface Ipc {
    emit(key: string, value: any): Promise<void>;
    onEvent(handler: (key: string, value: any) => any): void;
    lock(key: string): Promise<boolean>;
    unlock(key: string): Promise<void>;
}
