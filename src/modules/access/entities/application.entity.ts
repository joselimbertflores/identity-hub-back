import { Column, Entity, OneToMany, CreateDateColumn, PrimaryGeneratedColumn, BeforeInsert, BeforeUpdate } from 'typeorm';
import { UserApplication } from './user-application.entity';

@Entity('applications')
export class Application {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  clientId: string;

  @Column({ length: 150 })
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column()
  launchUrl: string;

  @Column({ length: 9, nullable: true })
  color: string;

  @Column()
  clientSecret: string;

  @Column({ default: true })
  isConfidential: boolean;

  @Column('text', { array: true })
  redirectUris: string[];

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => UserApplication, (userApplication) => userApplication.application)
  userApplications: UserApplication[];

  @CreateDateColumn()
  createdAt: Date;

  
  @BeforeInsert()
  @BeforeUpdate()
  normalizeClientId() {
    this.clientId = this.clientId
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '');
  }
}
