import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from 'src/modules/users/entities';

export enum PasswordActionPurpose {
  INITIAL_SETUP = 'INITIAL_SETUP',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

@Entity('password_action_tokens')
@Index('uq_password_action_tokens_user', ['userId'], { unique: true })
@Index('uq_password_action_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_password_action_tokens_expires_at', ['expiresAt'])
export class PasswordActionToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: PasswordActionPurpose })
  purpose: PasswordActionPurpose;

  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
