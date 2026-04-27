import {
  Column,
  Entity,
  ManyToMany,
  BeforeInsert,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from 'src/modules/users/entities';

@Entity('applications')
export class Application {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  clientId: string;

  @Column({ length: 150 })
  name: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column()
  launchUrl: string;

  @Column({ length: 7, nullable: true })
  color: string;

  @Column()
  clientSecretHash: string;

  @Column({ default: true })
  isConfidential: boolean;

  @Column('text', { array: true })
  redirectUris: string[];

  @Column({ default: true })
  isActive: boolean;

  @ManyToMany(() => User, (user) => user.applications)
  users: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  normalizeClientId() {
    this.clientId = this.clientId
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '');
  }
}
